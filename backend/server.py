import os
import uuid
import base64
import sqlite3
import re
import html
import time
import threading
import logging
import logging.handlers
import json
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from typing import Optional
from passlib.context import CryptContext
from jose import JWTError, jwt
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import httpx
from ultralytics import YOLO

from sqlalchemy import Column, String, Text, create_engine
from sqlalchemy.types import JSON as SQLJSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

try:
    import boto3
    from botocore.exceptions import ClientError as BotoClientError
    _BOTO3_OK = True
except ImportError:
    _BOTO3_OK = False

# ── Paths ──────────────────────────────────────────────────────────────────────
_DIR             = os.path.dirname(os.path.abspath(__file__))
PLATE_MODEL_PATH = os.path.join(_DIR, '..', 'licence_plate.pt')
# Database lives in data/ so the docker-compose volume mount persists it across updates
_DATA_DIR        = os.path.join(_DIR, 'data')
os.makedirs(_DATA_DIR, exist_ok=True)
DB_PATH          = os.path.join(_DATA_DIR, 'users.db')
UPLOADS_DIR      = os.path.join(_DIR, 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# ── Logging setup ──────────────────────────────────────────────────────────────
logging.basicConfig(
    level    = os.getenv("LOG_LEVEL", "INFO").upper(),
    format   = "%(asctime)s [%(levelname)-8s] %(name)s: %(message)s",
    datefmt  = "%Y-%m-%d %H:%M:%S",
    handlers = [
        logging.StreamHandler(),
        logging.handlers.RotatingFileHandler(
            os.path.join(_DIR, "autotrack.log"),
            maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        ),
    ],
)
log = logging.getLogger("autotrack")
logging.getLogger("ultralytics").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("passlib").setLevel(logging.WARNING)

# ── Sentry error tracking (optional — set SENTRY_DSN in .env to enable) ───────
_SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
if _SENTRY_DSN:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        sentry_sdk.init(
            dsn=_SENTRY_DSN,
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
            traces_sample_rate=0.1,
            send_default_pii=False,
        )
        log.info("Sentry error tracking enabled")
    except ImportError:
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed; run: pip install sentry-sdk[fastapi]")

# ── SQLAlchemy setup (vehicles) ────────────────────────────────────────────────
SA_URL  = f"sqlite:///{DB_PATH}"
engine  = create_engine(SA_URL, connect_args={"check_same_thread": False})
Session_ = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base    = declarative_base()

class VehicleORM(Base):
    __tablename__     = "vehicles"
    id                = Column(String,  primary_key=True)
    license_plate     = Column(String,  nullable=True)
    status            = Column(String,  nullable=False, default="WAITING")
    image_url         = Column(Text,    nullable=True)
    plate_image_url   = Column(Text,    nullable=True)
    history           = Column(SQLJSON, nullable=True, default=list)
    timestamp         = Column(String,  nullable=False)
    last_update       = Column(String,  nullable=True)
    tenant_id         = Column(String,  nullable=False)
    pending_direction = Column(String,  nullable=True)
    plate_status      = Column(String,  nullable=True)
    confidence        = Column(String,  nullable=True)
    direction         = Column(String,  nullable=True)
    qr_code_url       = Column(Text,    nullable=True)
    detection_log     = Column(SQLJSON, nullable=True)

Base.metadata.create_all(bind=engine)

def get_db():
    db = Session_()
    try:
        yield db
    finally:
        db.close()

def vehicle_to_dict(v: VehicleORM) -> dict:
    return {
        "id":               v.id,
        "licensePlate":     v.license_plate,
        "status":           v.status,
        "imageUrl":         v.image_url,
        "plateImageUrl":    v.plate_image_url,
        "history":          v.history or [],
        "timestamp":        v.timestamp,
        "lastUpdate":       v.last_update,
        "tenantId":         v.tenant_id,
        "pendingDirection": v.pending_direction,
        "plateStatus":      v.plate_status,
        "confidence":       v.confidence,
        "direction":        v.direction,
        "qrCodeUrl":        v.qr_code_url,
        "detectionLog":     v.detection_log,
    }

# ── Branch sync helpers ────────────────────────────────────────────────────────

def get_branch_config() -> dict:
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT key, value FROM app_config WHERE key IN ('branch_id','branch_name','cloud_url','cloud_api_key')"
    )
    rows = cursor.fetchall()
    conn.close()
    return {k: v for k, v in rows}

def enqueue_sync_event(event_type: str, vehicle_id: str, payload: dict):
    config = get_branch_config()
    if not config.get('cloud_url') or not config.get('cloud_api_key'):
        return
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO sync_queue (event_type, vehicle_id, payload, created_at) VALUES (?,?,?,?)",
        (event_type, vehicle_id, json.dumps(payload), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()

def _increment_attempts(row_ids: list):
    if not row_ids:
        return
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        f"UPDATE sync_queue SET attempts = attempts + 1 WHERE id IN ({','.join('?'*len(row_ids))})",
        row_ids,
    )
    conn.commit()
    conn.close()

def _increment_user_attempts(row_ids: list):
    if not row_ids:
        return
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        f"UPDATE user_sync_queue SET attempts = attempts + 1 WHERE id IN ({','.join('?'*len(row_ids))})",
        row_ids,
    )
    conn.commit()
    conn.close()

def enqueue_user_sync(event_type: str, user_id: int, payload: dict):
    config = get_branch_config()
    if not config.get('cloud_url') or not config.get('cloud_api_key'):
        return
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO user_sync_queue (event_type, user_id, payload, created_at) VALUES (?,?,?,?)",
        (event_type, user_id, json.dumps(payload), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()

async def _flush_user_sync_queue():
    config    = get_branch_config()
    cloud_url = config.get('cloud_url', '').rstrip('/')
    api_key   = config.get('cloud_api_key', '')
    branch_id = config.get('branch_id', '')
    if not all([cloud_url, api_key, branch_id]):
        return
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, event_type, user_id, payload FROM user_sync_queue WHERE attempts < 10 ORDER BY id LIMIT 50"
    )
    rows = cursor.fetchall()
    conn.close()
    if not rows:
        return
    users_payload = [{'event_type': r[1], 'user_id': r[2], 'payload': json.loads(r[3])} for r in rows]
    row_ids       = [r[0] for r in rows]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f'{cloud_url}/sync/users',
                json={'branch_id': branch_id, 'users': users_payload},
                headers={'X-Branch-Key': api_key},
            )
        if resp.status_code == 200:
            conn   = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                f"DELETE FROM user_sync_queue WHERE id IN ({','.join('?'*len(row_ids))})", row_ids
            )
            conn.commit()
            conn.close()
            log.info("Synced %d user event(s) to cloud", len(users_payload))
        else:
            _increment_user_attempts(row_ids)
    except Exception as e:
        _increment_user_attempts(row_ids)
        log.warning("User sync failed: %s", e)

async def _poll_commands():
    config    = get_branch_config()
    cloud_url = config.get('cloud_url', '').rstrip('/')
    api_key   = config.get('cloud_api_key', '')
    if not all([cloud_url, api_key]):
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f'{cloud_url}/sync/commands',
                headers={'X-Branch-Key': api_key},
            )
        if resp.status_code != 200:
            return
        commands = resp.json().get('commands', [])
        if not commands:
            return
        executed_ids = []
        conn   = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        for cmd in commands:
            cmd_id   = cmd['id']
            cmd_type = cmd['command_type']
            payload  = cmd['payload'] if isinstance(cmd['payload'], dict) else json.loads(cmd['payload'])
            try:
                if cmd_type == 'update_user_status':
                    email  = payload.get('email')
                    status = payload.get('status')
                    if email and status in ('active', 'inactive', 'pending'):
                        cursor.execute("UPDATE users SET status = ? WHERE email = ?", (status, email))
                elif cmd_type == 'update_vehicle_status':
                    vehicle_id = payload.get('vehicle_id')
                    new_status = payload.get('status')
                    if vehicle_id and new_status:
                        ts = datetime.now(timezone.utc).isoformat()
                        db = Session_()
                        try:
                            v = db.query(VehicleORM).filter(VehicleORM.id == vehicle_id).first()
                            if v:
                                v.status     = new_status
                                v.last_update = ts
                                v.history    = (v.history or []) + [{'status': new_status, 'timestamp': ts}]
                                db.commit()
                        finally:
                            db.close()
                elif cmd_type == 'delete_vehicle':
                    vehicle_id = payload.get('vehicle_id')
                    if vehicle_id:
                        db = Session_()
                        try:
                            v = db.query(VehicleORM).filter(VehicleORM.id == vehicle_id).first()
                            if v:
                                db.delete(v)
                                db.commit()
                        finally:
                            db.close()
                executed_ids.append(cmd_id)
            except Exception as cmd_err:
                log.warning("Command %s execution failed: %s", cmd_id, cmd_err)
        conn.commit()
        conn.close()
        if executed_ids:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f'{cloud_url}/sync/commands/done',
                    json={'command_ids': executed_ids},
                    headers={'X-Branch-Key': api_key},
                )
            log.info("Executed %d command(s) from cloud", len(executed_ids))
    except Exception as e:
        log.warning("Command poll failed: %s", e)

async def _flush_sync_queue():
    config    = get_branch_config()
    cloud_url = config.get('cloud_url', '').rstrip('/')
    api_key   = config.get('cloud_api_key', '')
    branch_id = config.get('branch_id', '')
    if not all([cloud_url, api_key, branch_id]):
        return
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, event_type, vehicle_id, payload FROM sync_queue WHERE attempts < 10 ORDER BY id LIMIT 50"
    )
    rows = cursor.fetchall()
    conn.close()
    if not rows:
        return
    events  = [{'event_type': r[1], 'vehicle_id': r[2], 'payload': json.loads(r[3])} for r in rows]
    row_ids = [r[0] for r in rows]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f'{cloud_url}/sync/events',
                json={'branch_id': branch_id, 'events': events},
                headers={'X-Branch-Key': api_key},
            )
        if resp.status_code == 200:
            conn   = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute(
                f"DELETE FROM sync_queue WHERE id IN ({','.join('?'*len(row_ids))})", row_ids
            )
            conn.commit()
            conn.close()
            log.info("Synced %d event(s) to cloud", len(events))
        else:
            _increment_attempts(row_ids)
            log.warning("Cloud sync HTTP %d", resp.status_code)
    except Exception as e:
        _increment_attempts(row_ids)
        log.warning("Cloud sync failed: %s", e)

async def _sync_loop():
    while True:
        await asyncio.sleep(5)
        try:
            await _flush_sync_queue()
            await _flush_user_sync_queue()
            await _poll_commands()
        except Exception as e:
            log.error("Sync loop crashed: %s", e)

async def _auto_discover_branch_id():
    """
    If cloud is configured but branch_id is missing (fresh install),
    call /branches/me to get the correct branch_id from the cloud.
    This runs once on startup.
    """
    config    = get_branch_config()
    cloud_url = config.get('cloud_url', '').rstrip('/')
    api_key   = config.get('cloud_api_key', '')
    branch_id = config.get('branch_id', '')
    if not cloud_url or not api_key or branch_id:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f'{cloud_url}/branches/me',
                headers={'X-Branch-Key': api_key},
            )
        if resp.status_code == 200:
            cloud_branch_id = resp.json().get('branch_id')
            if cloud_branch_id:
                conn   = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT OR REPLACE INTO app_config (key, value) VALUES ('branch_id', ?)",
                    (cloud_branch_id,)
                )
                conn.commit()
                conn.close()
                log.info("Branch ID auto-discovered on startup: %s", cloud_branch_id)
    except Exception as e:
        log.warning("Startup branch_id discovery failed: %s", e)

@asynccontextmanager
async def lifespan(_):
    await _auto_discover_branch_id()
    task = asyncio.create_task(_sync_loop())
    yield
    task.cancel()

# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(lifespan=lifespan)

# Rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Security headers on every response
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"]        = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"]       = "1; mode=block"
        response.headers["Referrer-Policy"]        = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)

class RequestLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start    = time.perf_counter()
        response = await call_next(request)
        ms       = (time.perf_counter() - start) * 1000
        log.info("%s %s → %d  (%.0fms)", request.method, request.url.path, response.status_code, ms)
        return response

_raw_origins    = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.add_middleware(RequestLogMiddleware)

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# ── JWT config ────────────────────────────────────────────────────────────────
SECRET_KEY              = os.getenv("JWT_SECRET_KEY", "fallback-insecure-key-set-env-var")
ALGORITHM               = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS  = 8   # one full workshop shift
REFRESH_TOKEN_EXPIRE_DAYS  = 7   # stay logged in for a week

def create_access_token(email: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": email, "role": role, "type": "access", "exp": expire},
        SECRET_KEY, algorithm=ALGORITHM,
    )

def create_refresh_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": email, "type": "refresh", "exp": expire},
        SECRET_KEY, algorithm=ALGORITHM,
    )

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(authorization.split(" ", 1)[1])
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload

# ── Password hashing ───────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

def verify_password(plain, hashed):
    return pwd_context.verify(plain, hashed)

# ── Users + config tables (raw SQLite) ────────────────────────────────────────
def init_db():
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            hashed_password TEXT NOT NULL,
            role TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS app_config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sync_queue (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT    NOT NULL,
            vehicle_id TEXT    NOT NULL,
            payload    TEXT    NOT NULL,
            created_at TEXT    NOT NULL,
            attempts   INTEGER DEFAULT 0
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_sync_queue (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT    NOT NULL,
            user_id    INTEGER NOT NULL,
            payload    TEXT    NOT NULL,
            created_at TEXT    NOT NULL,
            attempts   INTEGER DEFAULT 0
        )
    ''')
    # Migrate: add status column to users if it doesn't exist yet
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    except Exception:
        pass
    conn.commit()
    conn.close()

init_db()

def _load_initial_config():
    """
    On first startup after a fresh install, the Inno Setup installer writes
    backend/data/initial_config.json with cloud URL, API key, and branch name.
    We read it here, populate app_config, auto-discover the branch_id from the
    cloud, then delete the file so it only runs once.
    """
    config_file = os.path.join(_DATA_DIR, 'initial_config.json')
    if not os.path.exists(config_file):
        return
    try:
        with open(config_file, 'r') as f:
            initial = json.load(f)
        conn   = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM app_config")
        if cursor.fetchone()[0] == 0:
            for key, value in initial.items():
                if value:
                    cursor.execute(
                        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                        (key, value)
                    )
            conn.commit()
            log.info("Installer config loaded: branch_name=%s", initial.get('branch_name', ''))
        conn.close()
        os.remove(config_file)
    except Exception as e:
        log.warning("Failed to load initial config: %s", e)

_load_initial_config()

# ── RTSP helpers ───────────────────────────────────────────────────────────────
def get_rtsp_url() -> str:
    """Returns RTSP URL from DB (admin-configured) with .env as fallback."""
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM app_config WHERE key = 'rtsp_url'")
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else os.getenv("RTSP_URL", "")

def mask_rtsp_url(url: str) -> str:
    """Replace credentials in rtsp://user:pass@host with rtsp://***@host."""
    return re.sub(r'(rtsp://)([^@]+)@', r'\1***@', url) if url else ""

# ── Cloud storage config ───────────────────────────────────────────────────────
S3_ENDPOINT  = os.getenv("S3_ENDPOINT_URL",      "").strip()
S3_KEY       = os.getenv("S3_ACCESS_KEY_ID",     "").strip()
S3_SECRET    = os.getenv("S3_SECRET_ACCESS_KEY", "").strip()
S3_BUCKET    = os.getenv("S3_BUCKET_NAME",       "autotrack-images").strip()
S3_PUBLIC    = os.getenv("S3_PUBLIC_URL",        "").strip().rstrip("/")
IMAGE_RETAIN = int(os.getenv("IMAGE_RETENTION_DAYS", "30"))

_s3 = None   # lazy singleton

def _get_s3():
    global _s3
    if not _BOTO3_OK or not all([S3_KEY, S3_SECRET, S3_BUCKET]):
        return None
    if _s3 is None:
        kwargs = dict(
            aws_access_key_id=S3_KEY,
            aws_secret_access_key=S3_SECRET,
        )
        if S3_ENDPOINT:
            kwargs["endpoint_url"] = S3_ENDPOINT
        _s3 = boto3.client("s3", **kwargs)
    return _s3

def upload_to_storage(img_bytes: bytes, filename: str) -> str:
    """Upload image bytes. Returns public URL. Falls back to local disk if no cloud configured."""
    s3 = _get_s3()
    if s3:
        try:
            s3.put_object(
                Bucket=S3_BUCKET,
                Key=filename,
                Body=img_bytes,
                ContentType="image/jpeg",
            )
            base = S3_PUBLIC or f"{S3_ENDPOINT}/{S3_BUCKET}"
            return f"{base}/{filename}"
        except BotoClientError as e:
            log.warning("Cloud upload failed, using local disk: %s", e)
    # Local fallback
    filepath = os.path.join(UPLOADS_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(img_bytes)
    return f"/uploads/{filename}"

def delete_from_storage(url: str):
    """Delete an image by its stored URL (cloud or local)."""
    if not url:
        return
    s3 = _get_s3()
    if s3 and S3_PUBLIC and url.startswith(S3_PUBLIC):
        key = url[len(S3_PUBLIC):].lstrip("/")
        try:
            s3.delete_object(Bucket=S3_BUCKET, Key=key)
        except BotoClientError:
            pass
    elif url.startswith("/uploads/"):
        try:
            os.remove(os.path.join(UPLOADS_DIR, url[len("/uploads/"):]))
        except FileNotFoundError:
            pass

# ── Upload limits & validation ─────────────────────────────────────────────────
MAX_UPLOAD_BYTES  = 5 * 1024 * 1024          # 5 MB for multipart uploads
MAX_BASE64_CHARS  = 7 * 1024 * 1024          # ~5 MB image encoded as base64
ALLOWED_MIME      = {"image/jpeg", "image/png", "image/webp"}
# JPEG, PNG, WebP magic bytes
IMAGE_SIGNATURES  = (
    b'\xff\xd8\xff',   # JPEG
    b'\x89PNG',        # PNG
    b'RIFF',           # WebP (starts with RIFF....WEBP)
)

def is_valid_image_bytes(data: bytes) -> bool:
    return any(data.startswith(sig) for sig in IMAGE_SIGNATURES)

# ── Input sanitization ─────────────────────────────────────────────────────────
def sanitize_plate(text: str) -> str:
    """Keep only A-Z and 0-9, max 15 characters."""
    if not text:
        return ""
    return re.sub(r'[^A-Z0-9]', '', text.upper())[:15]

def sanitize_text(text: str, max_len: int = 255) -> str:
    """Strip HTML tags, escape special chars, truncate."""
    if not text:
        return text
    text = re.sub(r'<[^>]+>', '', text)   # strip tags
    text = html.escape(text)              # escape & < > " '
    return text[:max_len].strip()

# ── Pydantic schemas ───────────────────────────────────────────────────────────
class UserRegister(BaseModel):
    username: str
    email:    str
    password: str
    role:     str

class UserLogin(BaseModel):
    email:    str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class RtspConfig(BaseModel):
    rtsp_url: str

class BranchConfig(BaseModel):
    branch_name:   str
    cloud_url:     str
    cloud_api_key: str

class VehicleCreate(BaseModel):
    id:                str
    license_plate:     Optional[str]  = None
    status:            str            = "WAITING"
    image_url:         Optional[str]  = None
    plate_image_url:   Optional[str]  = None
    history:           list           = []
    timestamp:         str
    tenant_id:         str
    pending_direction: Optional[str]  = None
    plate_status:      Optional[str]  = None
    confidence:        Optional[str]  = None
    direction:         Optional[str]  = None
    qr_code_url:       Optional[str]  = None
    detection_log:     Optional[list] = None

class VehicleUpdate(BaseModel):
    license_plate:     Optional[str]  = None
    status:            Optional[str]  = None
    image_url:         Optional[str]  = None
    plate_image_url:   Optional[str]  = None
    history:           Optional[list] = None
    last_update:       Optional[str]  = None
    pending_direction: Optional[str]  = None
    plate_status:      Optional[str]  = None
    detection_log:     Optional[list] = None

class ImageUpload(BaseModel):
    image: str  # base64 data URL

class UserStatusUpdate(BaseModel):
    status: str  # 'active' or 'inactive'

# ── YOLO models ────────────────────────────────────────────────────────────────
VEHICLE_CLASSES = [2, 3, 5, 7]

try:
    log.info("Loading car detection model (yolov8n)...")
    car_model = YOLO("yolov8n.pt")
    log.info("Car model loaded")
except Exception as e:
    log.warning("Car model failed to load: %s", e)
    car_model = None

try:
    log.info("Loading license plate model from %s", PLATE_MODEL_PATH)
    plate_model = YOLO(PLATE_MODEL_PATH)
    log.info("Plate model loaded")
except Exception as e:
    log.error("Plate model failed to load: %s", e)
    plate_model = None

try:
    from paddleocr import PaddleOCR
    log.info("Initializing PaddleOCR...")
    ocr_reader = PaddleOCR(use_textline_orientation=True, lang='en', device='cpu', enable_mkldnn=False)
    log.info("PaddleOCR ready")
except Exception as e:
    log.warning("PaddleOCR failed to load: %s", e)
    PaddleOCR  = None
    ocr_reader = None


# ── OCR pipeline ───────────────────────────────────────────────────────────────

def rectify_plate(image):
    gray    = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged   = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return cv2.copyMakeBorder(image, 5, 5, 5, 5, cv2.BORDER_REPLICATE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    plate_contour = None
    for c in contours:
        peri  = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4:
            plate_contour = approx
            break
    if plate_contour is not None:
        pts  = plate_contour.reshape(4, 2)
        rect = np.zeros((4, 2), dtype="float32")
        s    = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        diff    = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        (tl, tr, br, bl) = rect
        widthA   = np.sqrt(((br[0]-bl[0])**2) + ((br[1]-bl[1])**2))
        widthB   = np.sqrt(((tr[0]-tl[0])**2) + ((tr[1]-tl[1])**2))
        maxWidth = max(int(widthA), int(widthB))
        heightA  = np.sqrt(((tr[0]-br[0])**2) + ((tr[1]-br[1])**2))
        heightB  = np.sqrt(((tl[0]-bl[0])**2) + ((tl[1]-bl[1])**2))
        maxHeight = max(int(heightA), int(heightB))
        dst = np.array([[0,0],[maxWidth-1,0],[maxWidth-1,maxHeight-1],[0,maxHeight-1]], dtype="float32")
        M   = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
        ph = int(maxHeight * 0.05); pw = int(maxWidth * 0.05)
        return cv2.copyMakeBorder(warped, ph, ph, pw, pw, cv2.BORDER_REPLICATE)
    return cv2.copyMakeBorder(image, 5, 5, 5, 5, cv2.BORDER_REPLICATE)


def _generate_variants(image, prefix):
    gray      = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe2    = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    clahe_img = clahe2.apply(gray)
    bilateral = cv2.bilateralFilter(clahe_img, 11, 17, 17)
    _, otsu   = cv2.threshold(bilateral, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, hc     = cv2.threshold(clahe_img,  0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    b, g, r   = cv2.split(image)
    ev        = cv2.addWeighted(b, 0.5, r, 0.5, 0)
    ev        = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8)).apply(ev)
    sharp_k   = np.array([[-1,-1,-1],[-1,9,-1],[-1,-1,-1]])
    raw = {
        f'{prefix}_bilateral':         bilateral,
        f'{prefix}_adaptive_mean':     cv2.adaptiveThreshold(bilateral, 255, cv2.ADAPTIVE_THRESH_MEAN_C,     cv2.THRESH_BINARY, 11, 2),
        f'{prefix}_adaptive_gaussian': cv2.adaptiveThreshold(bilateral, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2),
        f'{prefix}_otsu':              otsu,
        f'{prefix}_inverted':          cv2.bitwise_not(otsu),
        f'{prefix}_sharpened':         cv2.filter2D(clahe_img, -1, sharp_k),
        f'{prefix}_high_contrast':     hc,
        f'{prefix}_ev_optimized':      ev,
    }
    return {k: cv2.resize(v, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC) for k, v in raw.items()}


def preprocess_variants(rectified, raw):
    variants = {}
    variants.update(_generate_variants(rectified, 'rect'))
    variants.update(_generate_variants(raw, 'raw'))
    return variants


def postprocess_text(text):
    if text.upper().startswith('IND'):
        text = text[3:]
    text = re.sub(r'[^A-Z0-9]', '', text.upper())
    if len(text) == 11 and text[0] == 'I':
        text = text[1:]
    to_letter = {'0':'O','1':'I','2':'Z','5':'S','8':'B','4':'A','6':'G'}
    to_digit  = {'O':'0','I':'1','Z':'2','S':'5','B':'8','A':'4','G':'6'}
    corrected = []
    for i, char in enumerate(text):
        if i == 0 and char in ('H','N','M') and len(text) > 1 and text[1] == 'B':
            corrected.append('W'); continue
        if i == 0 and char in ('H','N'):
            corrected.append('W'); continue
        if i in (0,1,4,5) and char.isdigit():
            corrected.append(to_letter.get(char, char))
        elif i in (2,3,6,7,8,9) and char.isalpha():
            corrected.append(to_digit.get(char, char))
        else:
            corrected.append(char)
    return ''.join(corrected)


def run_ocr_multiple(variants, reader):
    candidates = []
    if reader is None:
        return candidates
    for name, img in variants.items():
        img_bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR) if len(img.shape) == 2 else img
        try:
            results = reader.predict(img_bgr, use_textline_orientation=True)
        except Exception:
            continue
        if not results:
            continue
        res_obj = results[0]
        texts  = res_obj.get('rec_texts', [])
        scores = res_obj.get('rec_scores', [])
        boxes  = res_obj.get('dt_polys', [])
        if not texts:
            continue
        blocks = sorted(
            [(boxes[i][0][0] if i < len(boxes) and len(boxes[i]) > 0 else 0, texts[i], scores[i])
             for i in range(len(texts))],
            key=lambda x: x[0]
        )
        merged_text = ''.join(b[1] for b in blocks)
        avg_conf    = sum(b[2] for b in blocks) / len(blocks)
        candidates.append((merged_text, avg_conf, name))
    return candidates


def select_best_result(candidates):
    patterns = [
        re.compile(r'^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$'),
        re.compile(r'^[A-Z]{2}[0-9]{2}[A-Z]{1}[0-9]{4}$'),
        re.compile(r'^[A-Z]{2}[0-9]{2}[0-9]{4}$'),
    ]
    all_preds        = []
    valid_candidates = []
    for text, conf, variant_name in candidates:
        if conf < 0.4:
            continue
        cleaned = postprocess_text(text)
        all_preds.append({'raw': text, 'cleaned': cleaned, 'conf': conf, 'variant': variant_name})
        for p in patterns:
            if p.match(cleaned):
                boost = 0.2 if len(cleaned) == 10 else 0.0
                valid_candidates.append((cleaned, conf + boost))
                break
    if valid_candidates:
        valid_candidates.sort(key=lambda x: x[1], reverse=True)
        best_text, best_conf = valid_candidates[0]
    elif all_preds:
        all_preds.sort(key=lambda x: x['conf'], reverse=True)
        best_text = all_preds[0]['cleaned']
        best_conf = all_preds[0]['conf']
    else:
        best_text, best_conf = '', 0.0
    return best_text, best_conf, all_preds


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.post("/register")
@limiter.limit("5/minute")
def register(request: Request, user: UserRegister):
    if not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', user.email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(user.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(user.username.strip()) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 characters")
    if user.role == 'superadmin':
        raise HTTPException(status_code=403, detail="Cannot register as superadmin")
    if user.role not in ('staff', 'admin'):
        raise HTTPException(status_code=400, detail="Invalid role")
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE email = ?", (user.email.lower().strip(),))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")
    # Admin accounts go pending only when cloud is configured (needs a superadmin to approve)
    config             = get_branch_config()
    is_cloud_connected = bool(config.get('cloud_url') and config.get('cloud_api_key'))
    status = 'pending' if user.role == 'admin' and is_cloud_connected else 'active'
    hashed = get_password_hash(user.password)
    cursor.execute(
        "INSERT INTO users (username, email, hashed_password, role, status) VALUES (?, ?, ?, ?, ?)",
        (sanitize_text(user.username, 100), user.email.lower().strip(), hashed, user.role, status)
    )
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    enqueue_user_sync('create', user_id, {
        'local_user_id': user_id,
        'username':      sanitize_text(user.username, 100),
        'email':         user.email.lower().strip(),
        'role':          user.role,
        'status':        status,
    })
    if status == 'pending':
        return {"message": "Registration submitted. Your account is pending approval by the super admin.", "pending": True}
    return {"message": "User registered successfully"}


@app.post("/login")
@limiter.limit("10/minute")
def login(request: Request, user_data: UserLogin):
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT username, email, hashed_password, role, status FROM users WHERE email = ?",
        (user_data.email.lower().strip(),)
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid email or password")
    username, email, hashed_password, role, status = row
    if not verify_password(user_data.password, hashed_password):
        raise HTTPException(status_code=400, detail="Invalid email or password")
    if status == 'pending':
        raise HTTPException(status_code=403, detail="Your account is pending approval by the super admin.")
    if status == 'inactive':
        raise HTTPException(status_code=403, detail="Your account has been deactivated. Contact your administrator.")
    return {
        "access_token":  create_access_token(email, role),
        "refresh_token": create_refresh_token(email),
        "token_type":    "bearer",
        "user": {
            "id":       "u" + email,
            "username": username,
            "email":    email,
            "role":     role,
            "name":     username,
        },
    }


@app.post("/refresh")
def refresh(payload: RefreshRequest):
    data = decode_token(payload.refresh_token)
    if data.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")
    email = data.get("sub")
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT role, status FROM users WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    role, status = row
    if status in ('pending', 'inactive'):
        raise HTTPException(status_code=403, detail="Account access restricted")
    return {
        "access_token": create_access_token(email, role),
        "token_type":   "bearer",
    }


# ── Feed config endpoints ─────────────────────────────────────────────────────

@app.get("/config/feed")
def get_feed_config(_: dict = Depends(get_current_user)):
    """Returns whether RTSP is configured and a masked URL (credentials hidden)."""
    url = get_rtsp_url()
    return {
        "configured":  bool(url),
        "masked_url":  mask_rtsp_url(url),
    }

@app.get("/config/branch")
async def get_branch_config_endpoint(_: dict = Depends(get_current_user)):
    config = get_branch_config()
    return {
        "branch_id":   config.get("branch_id"),
        "branch_name": config.get("branch_name"),
        "cloud_url":   config.get("cloud_url"),
        "configured":  bool(config.get("cloud_url") and config.get("cloud_api_key")),
    }

@app.post("/config/branch")
async def save_branch_config_endpoint(
    data: BranchConfig,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    cloud_url = data.cloud_url.rstrip('/')
    api_key   = data.cloud_api_key.strip()
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    for key, value in [
        ('branch_name',   data.branch_name.strip()),
        ('cloud_url',     cloud_url),
        ('cloud_api_key', api_key),
    ]:
        cursor.execute(
            "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)", (key, value)
        )
    conn.commit()
    conn.close()
    # Auto-discover the branch_id assigned by the cloud using the API key.
    # This is critical — the cloud rejects syncs where the local branch_id
    # doesn't match what was assigned at branch registration time.
    cloud_branch_id = None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f'{cloud_url}/branches/me',
                headers={'X-Branch-Key': api_key},
            )
        if resp.status_code == 200:
            cloud_branch_id = resp.json().get('branch_id')
            if cloud_branch_id:
                conn   = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT OR REPLACE INTO app_config (key, value) VALUES ('branch_id', ?)",
                    (cloud_branch_id,)
                )
                conn.commit()
                conn.close()
                log.info("Branch ID auto-discovered from cloud: %s", cloud_branch_id)
        else:
            log.warning("Cloud returned HTTP %d for /branches/me", resp.status_code)
    except Exception as e:
        log.warning("Could not reach cloud to discover branch_id: %s", e)
    return {"ok": True, "branch_id": cloud_branch_id, "connected": cloud_branch_id is not None}

@app.post("/config/rtsp")
def save_rtsp_config(
    data: RtspConfig,
    current_user: dict = Depends(get_current_user),
):
    """Admin-only: saves RTSP URL to the database. Clears camera cache."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if not data.rtsp_url.startswith("rtsp://"):
        raise HTTPException(status_code=400, detail="URL must start with rtsp://")
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES ('rtsp_url', ?)",
        (data.rtsp_url,)
    )
    conn.commit()
    conn.close()
    # Clear camera registry so next request reconnects with new URL
    with _camera_registry_lock:
        _camera_registry.clear()
    return {"ok": True, "masked_url": mask_rtsp_url(data.rtsp_url)}


# ── Image upload (protected) ───────────────────────────────────────────────────

@app.post("/upload-image")
@limiter.limit("60/minute")
def upload_image(
    request: Request,
    payload: ImageUpload,
    _: dict = Depends(get_current_user),
):
    if len(payload.image) > MAX_BASE64_CHARS:
        raise HTTPException(status_code=413, detail="Image too large. Maximum size is 5 MB.")
    try:
        raw = payload.image
        if ',' in raw:
            raw = raw.split(',', 1)[1]
        img_bytes = base64.b64decode(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data.")
    if not is_valid_image_bytes(img_bytes):
        raise HTTPException(status_code=400, detail="File is not a valid image.")
    filename = f"{uuid.uuid4().hex}.jpg"
    url = upload_to_storage(img_bytes, filename)
    return {"url": url}


# ── Vehicle CRUD (all protected) ───────────────────────────────────────────────

@app.get("/vehicles")
def list_vehicles(
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    rows = db.query(VehicleORM).all()
    return [vehicle_to_dict(v) for v in rows]


@app.post("/vehicles", status_code=201)
def create_vehicle(
    data: VehicleCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    tenant_id = "u" + current_user["sub"]
    row = VehicleORM(
        id                = data.id,
        license_plate     = sanitize_plate(data.license_plate) if data.license_plate else None,
        status            = data.status,
        image_url         = data.image_url,
        plate_image_url   = data.plate_image_url,
        history           = data.history,
        timestamp         = data.timestamp,
        tenant_id         = tenant_id,
        pending_direction = data.pending_direction,
        plate_status      = data.plate_status,
        confidence        = data.confidence,
        direction         = data.direction,
        qr_code_url       = data.qr_code_url,
        detection_log     = data.detection_log,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    enqueue_sync_event('create', row.id, vehicle_to_dict(row))
    return vehicle_to_dict(row)


@app.patch("/vehicles/{vehicle_id}")
def update_vehicle(
    vehicle_id: str,
    updates: VehicleUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    row = db.query(VehicleORM).filter(
        VehicleORM.id == vehicle_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    update_data = updates.dict(exclude_none=True)
    if "license_plate" in update_data and update_data["license_plate"]:
        update_data["license_plate"] = sanitize_plate(update_data["license_plate"])
    for field, val in update_data.items():
        setattr(row, field, val)
    db.commit()
    db.refresh(row)
    enqueue_sync_event('update', row.id, vehicle_to_dict(row))
    return vehicle_to_dict(row)


@app.delete("/vehicles/{vehicle_id}")
def delete_vehicle(
    vehicle_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_user),
):
    row = db.query(VehicleORM).filter(
        VehicleORM.id == vehicle_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    db.delete(row)
    db.commit()
    enqueue_sync_event('delete', vehicle_id, {'id': vehicle_id})
    return {"ok": True}


# ── User management (admin) ───────────────────────────────────────────────────

@app.get("/admin/users")
def list_branch_users(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, email, role, status FROM users ORDER BY role, username")
    rows = cursor.fetchall()
    conn.close()
    return [{'id': r[0], 'username': r[1], 'email': r[2], 'role': r[3], 'status': r[4]} for r in rows]


@app.patch("/admin/users/{user_id}/status")
def update_branch_user_status(
    user_id: int,
    data: UserStatusUpdate,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    if data.status not in ('active', 'inactive'):
        raise HTTPException(status_code=400, detail="Status must be 'active' or 'inactive'")
    conn   = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT role, email FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
    target_role, target_email = row
    # Branch admins may only manage staff — superadmin manages everyone
    if current_user.get("role") == "admin" and target_role != "staff":
        conn.close()
        raise HTTPException(status_code=403, detail="Admins can only manage staff accounts")
    cursor.execute("UPDATE users SET status = ? WHERE id = ?", (data.status, user_id))
    conn.commit()
    conn.close()
    enqueue_user_sync('update', user_id, {
        'local_user_id': user_id,
        'email':         target_email,
        'status':        data.status,
    })
    return {"ok": True}


# ── Plate detection ────────────────────────────────────────────────────────────

@app.post("/detect-plate")
@limiter.limit("30/minute")
def detect_plate(request: Request, file: UploadFile = File(...)):
    if plate_model is None:
        return {"error": "Plate model failed to load on server start."}

    # File type check
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images are accepted.")

    log = []
    try:
        # Read with size cap — abort if file exceeds limit
        contents = file.file.read(MAX_UPLOAD_BYTES + 1)
        if len(contents) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="File too large. Maximum size is 5 MB.")

        # Verify magic bytes — reject files that lie about their content type
        if not is_valid_image_bytes(contents):
            raise HTTPException(status_code=400, detail="File is not a valid image.")

        nparr    = np.frombuffer(contents, np.uint8)
        img      = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"error": "Invalid image received"}

        if car_model is not None:
            car_results    = car_model(img, classes=VEHICLE_CLASSES, device='cpu', verbose=False)
            car_boxes      = car_results[0].boxes if car_results else []
            vehicle_count  = len(car_boxes)
            log.append(f"[CAR] {vehicle_count} vehicle(s) detected by YOLOv8n")
            for box in car_boxes:
                cls_id   = int(box.cls[0])
                cls_name = {2:'car',3:'motorcycle',5:'bus',7:'truck'}.get(cls_id,'vehicle')
                log.append(f"  → {cls_name}  conf={float(box.conf[0]):.2f}")
        else:
            log.append("[CAR] Car model not loaded, skipping vehicle detection")

        plate_results = plate_model(img, device='cpu', verbose=False)
        plate_boxes   = plate_results[0].boxes if plate_results else []
        log.append(f"[PLATE] {len(plate_boxes)} plate(s) detected by licence_plate.pt")

        if len(plate_boxes) == 0:
            return {"found": False, "detection_log": log}

        best_box  = max(plate_boxes, key=lambda b: float(b.conf[0]))
        best_conf = float(best_box.conf[0])
        x1, y1, x2, y2 = map(int, best_box.xyxy[0].tolist())

        h, w   = img.shape[:2]
        pad_x  = int((x2-x1) * 0.05);  pad_y = int((y2-y1) * 0.05)
        px1    = max(0, x1-pad_x);     py1   = max(0, y1-pad_y)
        px2    = min(w, x2+pad_x);     py2   = min(h, y2+pad_y)
        log.append(f"  → Best plate bbox=[{x1},{y1},{x2},{y2}]  conf={best_conf:.2f}")

        plate_roi = img[py1:py2, px1:px2]
        if plate_roi.shape[0] == 0 or plate_roi.shape[1] == 0:
            log.append("[OCR] Plate crop is empty, skipping OCR")
            return {"found": True, "confidence": round(best_conf,3), "bbox":[x1,y1,x2,y2],
                    "plate_text": None, "ocr_confidence": 0.0, "detection_log": log}

        log.append("[OCR] Rectifying plate perspective...")
        rectified = rectify_plate(plate_roi)
        log.append("[OCR] Generating 16 preprocessing variants...")
        variants  = preprocess_variants(rectified, plate_roi)
        log.append("[OCR] Running PaddleOCR on all variants...")
        candidates = run_ocr_multiple(variants, ocr_reader)

        log.append(f"[OCR] {len(candidates)} variant(s) returned text:")
        for text, conf, variant_name in candidates:
            cleaned = postprocess_text(text)
            log.append(f"  [{variant_name}] raw='{text}'  cleaned='{cleaned}'  conf={conf:.2f}")

        best_text, best_ocr_conf, _ = select_best_result(candidates)
        if best_text:
            log.append(f"[RESULT] ✓ '{best_text}'  ocr_conf={best_ocr_conf:.2f}")
        else:
            log.append("[RESULT] No plate text could be read")

        # Encode plate crop and upload to storage
        display_img = cv2.resize(plate_roi, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        _, plate_buf = cv2.imencode('.jpg', display_img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        plate_filename = f"plate_{uuid.uuid4().hex}.jpg"
        plate_url = upload_to_storage(plate_buf.tobytes(), plate_filename)

        return {
            "found":           True,
            "confidence":      round(best_conf, 3),
            "bbox":            [x1, y1, x2, y2],
            "plate_url":       plate_url,
            "plate_text":      best_text or None,
            "ocr_confidence":  round(best_ocr_conf, 3),
            "detection_log":   log,
        }
    except Exception as e:
        log.append(f"[ERROR] {e}")
        log.error("Plate detection error: %s", e, exc_info=True)
        return {"error": str(e), "detection_log": log}


# ── Image cleanup ─────────────────────────────────────────────────────────────

def cleanup_old_images():
    """
    Delete images from EXITED vehicles older than IMAGE_RETAIN days.
    Nulls out image_url and plate_image_url in the DB after deletion.
    Active vehicles (WAITING/ENTERED/TEMP_OUT) are never touched.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=IMAGE_RETAIN)).isoformat()
    db = Session_()
    try:
        old_rows = db.query(VehicleORM).filter(
            VehicleORM.status == "EXITED",
            VehicleORM.timestamp < cutoff,
        ).filter(
            (VehicleORM.image_url != None) | (VehicleORM.plate_image_url != None)
        ).all()

        deleted = 0
        for row in old_rows:
            if row.image_url:
                delete_from_storage(row.image_url)
                row.image_url = None
            if row.plate_image_url:
                delete_from_storage(row.plate_image_url)
                row.plate_image_url = None
            deleted += 1

        if deleted:
            db.commit()
        log.info("Image cleanup: removed images from %d EXITED vehicle(s) older than %d days", deleted, IMAGE_RETAIN)
    except Exception as e:
        log.error("Image cleanup failed: %s", e, exc_info=True)
    finally:
        db.close()

def _schedule_cleanup():
    cleanup_old_images()
    t = threading.Timer(24 * 60 * 60, _schedule_cleanup)   # repeat every 24 h
    t.daemon = True
    t.start()

# Kick off the cleanup loop when the server starts
_schedule_cleanup()


@app.post("/admin/cleanup-images")
def trigger_cleanup(current_user: dict = Depends(get_current_user)):
    """Admin: manually trigger an immediate image cleanup run."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    threading.Thread(target=cleanup_old_images, daemon=True).start()
    return {"ok": True, "message": f"Cleanup started — removing images from EXITED vehicles older than {IMAGE_RETAIN} days."}


# ── RTSP video proxy ───────────────────────────────────────────────────────────

_camera_registry      = {}
_camera_registry_lock = threading.Lock()


class VideoCamera:
    def __init__(self, url):
        self.url        = url
        self.frame      = None
        self.is_running = True
        self.lock       = threading.Lock()
        self.thread     = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()
        log.info("Camera thread started: %s", mask_rtsp_url(url))

    def _capture_loop(self):
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        while self.is_running:
            success, frame = cap.read()
            if success:
                with self.lock:
                    self.frame = frame.copy()
            else:
                log.warning("RTSP connection lost, reconnecting...")
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    def get_jpeg(self):
        with self.lock:
            if self.frame is None:
                return None
            ret, buffer = cv2.imencode('.jpg', self.frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            return buffer.tobytes() if ret else None


def get_camera(url: str) -> VideoCamera:
    with _camera_registry_lock:
        if url not in _camera_registry:
            _camera_registry[url] = VideoCamera(url)
        return _camera_registry[url]


def gen_frames(url: str):
    camera = get_camera(url)
    log.info("New MJPEG client connected")
    while True:
        frame_bytes = camera.get_jpeg()
        if frame_bytes:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.03)


@app.get("/video-feed")
async def video_feed():
    url = get_rtsp_url()
    if not url:
        raise HTTPException(status_code=503, detail="RTSP URL not configured")
    return StreamingResponse(
        gen_frames(url),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control":              "no-cache, no-store, must-revalidate",
            "Pragma":                     "no-cache",
            "Expires":                    "0",
            "Connection":                 "keep-alive",
            "Access-Control-Allow-Origin":"*",
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
