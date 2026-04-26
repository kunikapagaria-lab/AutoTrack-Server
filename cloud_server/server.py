import os
import uuid
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from typing import Optional, List

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt

_DIR     = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH  = os.path.join(DATA_DIR, 'cloud.db')

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
    c.execute('''CREATE TABLE IF NOT EXISTS branch_users (
        local_user_id INTEGER NOT NULL,
        branch_id TEXT NOT NULL,
        username TEXT NOT NULL,
        email TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        synced_at TEXT NOT NULL,
        PRIMARY KEY (local_user_id, branch_id),
        FOREIGN KEY (branch_id) REFERENCES branches(id)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS pending_commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id TEXT NOT NULL,
        command_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        executed_at TEXT
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
    allow_methods=['GET', 'POST', 'PATCH', 'DELETE'],
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

class UserSyncEvent(BaseModel):
    event_type: str
    user_id:    int
    payload:    dict

class UserSyncPayload(BaseModel):
    branch_id: str
    users:     List[UserSyncEvent]

class CommandsDonePayload(BaseModel):
    command_ids: List[int]

class UserStatusUpdateCloud(BaseModel):
    status: str  # 'active' or 'inactive'

class ApproveUserPayload(BaseModel):
    branch_id:     str
    local_user_id: int
    action:        str  # 'approve' or 'reject'

class VehicleStatusUpdateCloud(BaseModel):
    status: str

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

@app.get('/branches/me')
async def get_my_branch(branch_id: str = Depends(verify_branch_key)):
    """Branch backend calls this with its API key to discover the cloud-assigned branch_id."""
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT id, name FROM branches WHERE id = ?', (branch_id,))
    row  = c.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail='Branch not found')
    return {'branch_id': row[0], 'name': row[1]}

@app.get('/branches')
async def list_branches(_: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT id, name, registered_at, last_seen FROM branches ORDER BY name')
    rows = c.fetchall()
    conn.close()
    return [{'id': r[0], 'name': r[1], 'registeredAt': r[2], 'lastSeen': r[3]} for r in rows]

@app.delete('/branches/{branch_id}')
async def delete_branch(branch_id: str, _: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT id FROM branches WHERE id = ?', (branch_id,))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail='Branch not found')
    c.execute('DELETE FROM vehicles WHERE branch_id = ?', (branch_id,))
    c.execute('DELETE FROM branch_users WHERE branch_id = ?', (branch_id,))
    c.execute('DELETE FROM pending_commands WHERE branch_id = ?', (branch_id,))
    c.execute('DELETE FROM branches WHERE id = ?', (branch_id,))
    conn.commit()
    conn.close()
    return {'ok': True}

# ── Vehicle sync (called by branch backends) ───────────────────────────────────

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

# ── User sync (called by branch backends) ──────────────────────────────────────

@app.post('/sync/users')
async def sync_users(payload: UserSyncPayload, branch_id: str = Depends(verify_branch_key)):
    if payload.branch_id != branch_id:
        raise HTTPException(status_code=403, detail='Branch ID mismatch')
    conn      = sqlite3.connect(DB_PATH)
    c         = conn.cursor()
    synced_at = datetime.now(timezone.utc).isoformat()
    for event in payload.users:
        p        = event.payload
        local_id = p.get('local_user_id', event.user_id)
        c.execute('''
            INSERT INTO branch_users (local_user_id, branch_id, username, email, role, status, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(local_user_id, branch_id) DO UPDATE SET
                username=excluded.username, email=excluded.email,
                role=excluded.role, status=excluded.status, synced_at=excluded.synced_at
        ''', (
            local_id, branch_id,
            p.get('username', ''), p.get('email', ''),
            p.get('role', 'staff'), p.get('status', 'active'), synced_at
        ))
    conn.commit()
    conn.close()
    return {'ok': True, 'synced': len(payload.users)}

# ── Command queue (branch polls these, then confirms) ─────────────────────────

@app.get('/sync/commands')
async def get_commands(branch_id: str = Depends(verify_branch_key)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('''
        SELECT id, command_type, payload FROM pending_commands
        WHERE branch_id = ? AND status = 'pending' AND attempts < 10
        ORDER BY id LIMIT 50
    ''', (branch_id,))
    rows = c.fetchall()
    conn.close()
    return {'commands': [{'id': r[0], 'command_type': r[1], 'payload': json.loads(r[2])} for r in rows]}

@app.post('/sync/commands/done')
async def mark_commands_done(payload: CommandsDonePayload, branch_id: str = Depends(verify_branch_key)):
    if not payload.command_ids:
        return {'ok': True}
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    placeholders = ','.join('?' * len(payload.command_ids))
    now = datetime.now(timezone.utc).isoformat()
    c.execute(
        f"UPDATE pending_commands SET status='executed', executed_at=? WHERE id IN ({placeholders}) AND branch_id=?",
        [now] + list(payload.command_ids) + [branch_id]
    )
    conn.commit()
    conn.close()
    return {'ok': True}

# ── Vehicle query and management (superadmin) ──────────────────────────────────

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

@app.patch('/vehicles/{vehicle_id}')
async def update_cloud_vehicle(
    vehicle_id: str,
    data: VehicleStatusUpdateCloud,
    branch_id: str = Query(...),
    _: dict = Depends(get_current_user),
):
    valid_statuses = ('WAITING', 'ENTERED', 'TEMP_OUT', 'EXITED')
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail='Invalid status')
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT id FROM vehicles WHERE id = ? AND branch_id = ?', (vehicle_id, branch_id))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail='Vehicle not found')
    ts = datetime.now(timezone.utc).isoformat()
    c.execute('UPDATE vehicles SET status = ?, last_update = ? WHERE id = ? AND branch_id = ?',
              (data.status, ts, vehicle_id, branch_id))
    c.execute(
        'INSERT INTO pending_commands (branch_id, command_type, payload, created_at) VALUES (?, ?, ?, ?)',
        (branch_id, 'update_vehicle_status', json.dumps({'vehicle_id': vehicle_id, 'status': data.status}), ts)
    )
    conn.commit()
    conn.close()
    return {'ok': True}

@app.delete('/vehicles/{vehicle_id}')
async def delete_cloud_vehicle(
    vehicle_id: str,
    branch_id: str = Query(...),
    _: dict = Depends(get_current_user),
):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT id FROM vehicles WHERE id = ? AND branch_id = ?', (vehicle_id, branch_id))
    if not c.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail='Vehicle not found')
    c.execute('DELETE FROM vehicles WHERE id = ? AND branch_id = ?', (vehicle_id, branch_id))
    ts = datetime.now(timezone.utc).isoformat()
    c.execute(
        'INSERT INTO pending_commands (branch_id, command_type, payload, created_at) VALUES (?, ?, ?, ?)',
        (branch_id, 'delete_vehicle', json.dumps({'vehicle_id': vehicle_id}), ts)
    )
    conn.commit()
    conn.close()
    return {'ok': True}

@app.get('/vehicles/export')
async def export_all_vehicles(_: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('''
        SELECT b.name, v.id, v.license_plate, v.status, v.timestamp,
               v.last_update, v.direction, v.history
        FROM vehicles v
        JOIN branches b ON v.branch_id = b.id
        ORDER BY v.timestamp DESC
    ''')
    rows = c.fetchall()
    conn.close()
    lines = ['Branch,Vehicle ID,License Plate,Status,Entry Time,Last Update,Direction,Activity Flow']
    for r in rows:
        branch_name, vid, plate, status, ts, lu, direction, history_json = r
        try:
            history = json.loads(history_json) if history_json else []
            flow    = ' >> '.join(f"{h['status']} ({h.get('timestamp','')[:16]})" for h in history)
        except Exception:
            flow = ''
        lines.append(f'"{branch_name}","{vid}","{plate or "PENDING"}","{status or ""}","{ts or ""}","{lu or ""}","{direction or ""}","{flow}"')
    csv_content = '\n'.join(lines)
    return Response(
        content=csv_content,
        media_type='text/csv',
        headers={'Content-Disposition': 'attachment; filename="consolidated_report.csv"'},
    )

# ── User management (superadmin) ───────────────────────────────────────────────

@app.get('/users')
async def list_all_users(_: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('''
        SELECT bu.local_user_id, bu.branch_id, b.name,
               bu.username, bu.email, bu.role, bu.status, bu.synced_at
        FROM branch_users bu
        JOIN branches b ON bu.branch_id = b.id
        ORDER BY bu.role, bu.username
    ''')
    rows = c.fetchall()
    conn.close()
    return [{
        'localUserId': r[0], 'branchId': r[1], 'branchName': r[2],
        'username': r[3], 'email': r[4], 'role': r[5], 'status': r[6], 'syncedAt': r[7],
    } for r in rows]

@app.get('/branches/{branch_id}/users')
async def list_branch_users(branch_id: str, _: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('''
        SELECT local_user_id, username, email, role, status, synced_at
        FROM branch_users WHERE branch_id = ? ORDER BY role, username
    ''', (branch_id,))
    rows = c.fetchall()
    conn.close()
    return [{'localUserId': r[0], 'username': r[1], 'email': r[2], 'role': r[3], 'status': r[4], 'syncedAt': r[5]} for r in rows]

@app.patch('/branches/{branch_id}/users/{user_id}/status')
async def update_branch_user_status(
    branch_id: str,
    user_id:   int,
    data:      UserStatusUpdateCloud,
    _:         dict = Depends(get_current_user),
):
    if data.status not in ('active', 'inactive'):
        raise HTTPException(status_code=400, detail='Status must be active or inactive')
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT email FROM branch_users WHERE branch_id = ? AND local_user_id = ?', (branch_id, user_id))
    row  = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail='User not found')
    email = row[0]
    c.execute('UPDATE branch_users SET status = ? WHERE branch_id = ? AND local_user_id = ?',
              (data.status, branch_id, user_id))
    c.execute(
        'INSERT INTO pending_commands (branch_id, command_type, payload, created_at) VALUES (?, ?, ?, ?)',
        (branch_id, 'update_user_status', json.dumps({'email': email, 'status': data.status}),
         datetime.now(timezone.utc).isoformat())
    )
    conn.commit()
    conn.close()
    return {'ok': True}

@app.post('/users/approve')
async def approve_user(data: ApproveUserPayload, _: dict = Depends(get_current_user)):
    if data.action not in ('approve', 'reject'):
        raise HTTPException(status_code=400, detail='Action must be approve or reject')
    new_status = 'active' if data.action == 'approve' else 'inactive'
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute('SELECT email FROM branch_users WHERE branch_id = ? AND local_user_id = ?',
              (data.branch_id, data.local_user_id))
    row  = c.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail='User not found')
    email = row[0]
    c.execute('UPDATE branch_users SET status = ? WHERE branch_id = ? AND local_user_id = ?',
              (new_status, data.branch_id, data.local_user_id))
    c.execute(
        'INSERT INTO pending_commands (branch_id, command_type, payload, created_at) VALUES (?, ?, ?, ?)',
        (data.branch_id, 'update_user_status', json.dumps({'email': email, 'status': new_status}),
         datetime.now(timezone.utc).isoformat())
    )
    conn.commit()
    conn.close()
    return {'ok': True}

@app.get('/pending-approvals/count')
async def pending_approvals_count(_: dict = Depends(get_current_user)):
    conn = sqlite3.connect(DB_PATH)
    c    = conn.cursor()
    c.execute("SELECT COUNT(*) FROM branch_users WHERE status = 'pending'")
    count = c.fetchone()[0]
    conn.close()
    return {'count': count}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('server:app', host='0.0.0.0', port=8000, reload=False)
