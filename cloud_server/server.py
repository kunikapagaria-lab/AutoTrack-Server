import os
import uuid
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from typing import Optional, List

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt

_DIR    = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, 'cloud.db')

SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'change-this-in-production')
ALGORITHM  = 'HS256'

pwd_ctx = CryptContext(schemes=['bcrypt'], deprecated='auto')

# ── DB ─────────────────────────────────────────────────────────────────────────

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'superadmin'
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS branches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key TEXT UNIQUE NOT NULL,
        registered_at TEXT NOT NULL,
        last_seen TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        license_plate TEXT,
        status TEXT,
        image_url TEXT,
        plate_image_url TEXT,
        history TEXT,
        timestamp TEXT,
        last_update TEXT,
        pending_direction TEXT,
        plate_status TEXT,
        confidence TEXT,
        direction TEXT,
        synced_at TEXT,
        PRIMARY KEY (id, branch_id)
    )''')
    conn.commit()
    conn.close()

init_db()

# ── App ────────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_):
    yield

app = FastAPI(lifespan=lifespan)

_raw_origins    = os.getenv('ALLOWED_ORIGINS', '*')
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(',') if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=['GET', 'POST'],
    allow_headers=['Authorization', 'Content-Type', 'X-Branch-Key'],
)

# ── JWT ────────────────────────────────────────────────────────────────────────

def create_access_token(email: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    return jwt.encode({'sub': email, 'role': 'superadmin', 'type': 'access', 'exp': exp}, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(email: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    return jwt.encode({'sub': email, 'type': 'refresh', 'exp': exp}, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail='Invalid or expired token')

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Not authenticated')
    payload = decode_token(authorization.split(' ', 1)[1])
    if payload.get('type') != 'access':
        raise HTTPException(status_code=401, detail='Invalid token type')
    return payload

async def verify_branch_key(x_branch_key: Optional[str] = Header(None)) -> str:
    if not x_branch_key:
        raise HTTPException(status_code=401, detail='Branch key required')
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT id FROM branches WHERE api_key = ?', (x_branch_key,))
    row  = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=401, detail='Invalid branch key')
    c.execute('UPDATE branches SET last_seen = ? WHERE id = ?',
              (datetime.now(timezone.utc).isoformat(), row[0]))
    conn.commit()
    conn.close()
    return row[0]

# ── Pydantic models ────────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    username: str
    email:    str
    password: str

class UserLogin(BaseModel):
    email:    str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class BranchRegister(BaseModel):
    name: str

class VehicleEvent(BaseModel):
    event_type: str
    vehicle_id: str
    payload:    dict

class SyncPayload(BaseModel):
    branch_id: str
    events:    List[VehicleEvent]

# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.post('/register')
async def register(user: UserRegister):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT COUNT(*) FROM users')
    if c.fetchone()[0] > 0:
        conn.close()
        raise HTTPException(status_code=403, detail='Registration closed. Contact your administrator.')
    if len(user.password) < 8:
        conn.close()
        raise HTTPException(status_code=400, detail='Password must be at least 8 characters')
    c.execute(
        "INSERT INTO users (username, email, hashed_password, role) VALUES (?, ?, ?, 'superadmin')",
        (user.username.strip(), user.email.lower().strip(), pwd_ctx.hash(user.password))
    )
    conn.commit()
    conn.close()
    return {'message': 'Superadmin account created'}

@app.post('/login')
async def login(data: UserLogin):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT username, email, hashed_password, role FROM users WHERE email = ?',
              (data.email.lower().strip(),))
    row  = c.fetchone()
    conn.close()
    if not row or not pwd_ctx.verify(data.password, row[2]):
        raise HTTPException(status_code=400, detail='Invalid email or password')
    username, email, _, role = row
    return {
        'access_token':  create_access_token(email),
        'refresh_token': create_refresh_token(email),
        'token_type':    'bearer',
        'user': {'username': username, 'email': email, 'role': role, 'name': username},
    }

@app.post('/refresh')
async def refresh(payload: RefreshRequest):
    data = decode_token(payload.refresh_token)
    if data.get('type') != 'refresh':
        raise HTTPException(status_code=401, detail='Invalid token type')
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT role FROM users WHERE email = ?', (data.get('sub'),))
    row  = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail='User not found')
    return {'access_token': create_access_token(data.get('sub')), 'token_type': 'bearer'}

# ── Branch management ──────────────────────────────────────────────────────────

@app.post('/branches/register')
async def register_branch(data: BranchRegister, _: dict = Depends(get_current_user)):
    branch_id = str(uuid.uuid4())
    api_key   = 'bk_' + uuid.uuid4().hex + uuid.uuid4().hex
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('INSERT INTO branches (id, name, api_key, registered_at) VALUES (?, ?, ?, ?)',
              (branch_id, data.name.strip(), api_key, datetime.now(timezone.utc).isoformat()))
    conn.commit()
    conn.close()
    return {'branch_id': branch_id, 'name': data.name.strip(), 'api_key': api_key}

@app.get('/branches')
async def list_branches(_: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT id, name, registered_at, last_seen FROM branches ORDER BY name')
    rows = c.fetchall()
    conn.close()
    return [{'id': r[0], 'name': r[1], 'registeredAt': r[2], 'lastSeen': r[3]} for r in rows]

# ── Sync endpoint (called by branch backends) ──────────────────────────────────

@app.post('/sync/events')
async def sync_events(payload: SyncPayload, branch_id: str = Depends(verify_branch_key)):
    if payload.branch_id != branch_id:
        raise HTTPException(status_code=403, detail='Branch ID mismatch')
    conn      = sqlite3.connect(DB_PATH)
    c         = conn.cursor()
    synced_at = datetime.now(timezone.utc).isoformat()
    for event in payload.events:
        if event.event_type in ('create', 'update'):
            p = event.payload
            c.execute('''
                INSERT INTO vehicles
                    (id, branch_id, license_plate, status, image_url, plate_image_url,
                     history, timestamp, last_update, pending_direction,
                     plate_status, confidence, direction, synced_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id, branch_id) DO UPDATE SET
                    license_plate=excluded.license_plate, status=excluded.status,
                    image_url=excluded.image_url, plate_image_url=excluded.plate_image_url,
                    history=excluded.history, last_update=excluded.last_update,
                    pending_direction=excluded.pending_direction,
                    plate_status=excluded.plate_status, confidence=excluded.confidence,
                    direction=excluded.direction, synced_at=excluded.synced_at
            ''', (
                p.get('id', event.vehicle_id), branch_id,
                p.get('licensePlate'), p.get('status'),
                p.get('imageUrl'), p.get('plateImageUrl'),
                json.dumps(p.get('history', [])),
                p.get('timestamp'), p.get('lastUpdate'),
                p.get('pendingDirection'), p.get('plateStatus'),
                p.get('confidence'), p.get('direction'), synced_at,
            ))
        elif event.event_type == 'delete':
            c.execute('DELETE FROM vehicles WHERE id = ? AND branch_id = ?',
                      (event.vehicle_id, branch_id))
    conn.commit()
    conn.close()
    return {'ok': True, 'synced': len(payload.events)}

# ── Vehicle query (admin reads) ────────────────────────────────────────────────

@app.get('/vehicles')
async def get_vehicles(branch_id: str, _: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('''
        SELECT id, license_plate, status, image_url, plate_image_url, history,
               timestamp, last_update, pending_direction, plate_status,
               confidence, direction, synced_at
        FROM vehicles WHERE branch_id = ? ORDER BY timestamp DESC
    ''', (branch_id,))
    rows = c.fetchall()
    conn.close()
    cols   = ['id', 'licensePlate', 'status', 'imageUrl', 'plateImageUrl', 'history',
              'timestamp', 'lastUpdate', 'pendingDirection', 'plateStatus',
              'confidence', 'direction', 'syncedAt']
    result = []
    for row in rows:
        v = dict(zip(cols, row))
        v['history'] = json.loads(v['history']) if v['history'] else []
        result.append(v)
    return result

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('server:app', host='0.0.0.0', port=8000, reload=False)
