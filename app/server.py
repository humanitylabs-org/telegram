"""Hello Wizard reference: one API/service layer used by the view and MCP.

Stdlib only. The host gateway owns authentication; direct ports stay loopback.
"""
import datetime as dt
import json
import os
import re
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent.parent if '__file__' in globals() else Path(os.environ.get('APP_ROOT', '.')).resolve()
DATA = Path(os.environ.get('DATA_DIR', ROOT / '.data'))
APP_ID = 'tg-style'
VERSION = '0.8.39'
STATIC_TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml'}


def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DATA / 'habits.sqlite3', timeout=10)
    c.row_factory = sqlite3.Row
    c.execute('CREATE TABLE IF NOT EXISTS habits (id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE)')
    c.execute('CREATE TABLE IF NOT EXISTS marks (habit_id INTEGER, day TEXT, PRIMARY KEY(habit_id,day))')
    return c


class Problem(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def resolve_day(value=None):
    """The owner's local day. Callers send it (the view knows the device's date); the
    server accepts only a real ISO date within a day of UTC, so a habit marked at 6 am in
    Bangkok lands on that morning, not on yesterday's UTC date."""
    utc = dt.datetime.now(dt.timezone.utc).date()
    if value in (None, ''):
        return utc.isoformat()
    try:
        day = dt.date.fromisoformat(str(value))
    except ValueError:
        raise Problem(400, 'day must be YYYY-MM-DD.') from None
    if abs((day - utc).days) > 1:
        raise Problem(400, 'day must be today in your timezone.')
    return day.isoformat()


def list_habits(day=None):
    day = resolve_day(day)
    c = connect()
    try:
        rows = c.execute('SELECT h.id,h.name,EXISTS(SELECT 1 FROM marks m WHERE m.habit_id=h.id AND m.day=?) AS done FROM habits h ORDER BY h.id', (day,)).fetchall()
        return {'day': day, 'habits': [dict(r, done=bool(r['done'])) for r in rows]}
    finally:
        c.close()


def add_habit(args):
    day = resolve_day(args.get('day'))
    name = args.get('name')
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 60:
        raise Problem(400, 'Use a habit name between 1 and 60 characters.')
    c = connect()
    try:
        with c:
            c.execute('INSERT INTO habits(name) VALUES (?)', (name.strip(),))
    except sqlite3.IntegrityError:
        raise Problem(409, 'That habit already exists.') from None
    finally:
        c.close()
    return list_habits(day)


def set_done(habit_id, args):
    done = args.get('done')
    if not isinstance(done, bool):
        raise Problem(400, 'done must be true or false.')
    day = resolve_day(args.get('day'))
    c = connect()
    try:
        with c:
            if not c.execute('SELECT id FROM habits WHERE id=?', (habit_id,)).fetchone():
                raise Problem(404, 'Habit not found.')
            if done:
                c.execute('INSERT OR IGNORE INTO marks VALUES (?,?)', (habit_id, day))
            else:
                c.execute('DELETE FROM marks WHERE habit_id=? AND day=?', (habit_id, day))
    finally:
        c.close()
    return list_habits(day)


TOOLS = [
    {'name': 'wizard_time', 'description': 'Current UTC time on the Wizard box.', 'inputSchema': {'type': 'object', 'properties': {}}},
    {'name': 'wizard_echo', 'description': 'Echo text to prove this app is reachable.', 'inputSchema': {'type': 'object', 'properties': {'text': {'type': 'string'}}, 'required': ['text']}},
    {'name': 'sweep_list', 'description': "The chats the owner had in his Ready folder when he tapped Sweep (id, title, status, ask, preview, time, unread). Without sweep_id: his newest sweep. Work them in chunks as the tg-style skill's Ready sweep section says.",
     'inputSchema': {'type': 'object', 'properties': {'sweep_id': {'type': 'string', 'description': 'From the sweep chat\'s first message; omit for the newest.'}}}},
    {'name': 'catchup_list', 'description': "What the owner had waiting when he tapped Catch me up: his Ready chats and unread notifications. "
                                            "These notifications are only the ones his routing sends to Chats: never read the Notifications app's inbox or report its unread count. "
                                            "Without catchup_id: his newest. Each catch-up is a fresh pull; follow the tg-style skill's Catch me up section.",
     'inputSchema': {'type': 'object', 'properties': {'catchup_id': {'type': 'string', 'description': 'From the catch-up chat\'s first message; omit for the newest.'}}}},
]


# ---- Ready sweep: the Sweep button saves what the Ready folder showed, so the sweep chat works that exact list ----
SWEEP_ID = re.compile(r'^sw_[0-9]{8}_[0-9]{6}_[0-9a-f]{6}$')


def _sweep_dir():
    d = DATA / 'sweeps'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _clip(v, n):
    return ' '.join(str(v or '').split())[:n]


def save_sweep(body):
    items = body.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 400:
        raise Problem(400, 'items must list 1 to 400 chats.')
    rows = []
    for it in items:
        if not isinstance(it, dict) or not isinstance(it.get('id'), str) or not 0 < len(it['id']) <= 120:
            raise Problem(400, 'Each item needs a chat id.')
        rows.append({'id': it['id'], 'title': _clip(it.get('title'), 120), 'status': _clip(it.get('status'), 40),
                     'state': _clip(it.get('state'), 20), 'ask': _clip(it.get('ask'), 300), 'preview': _clip(it.get('preview'), 300),
                     'time': _clip(it.get('time'), 40), 'unread': bool(it.get('unread'))})
    sid = time.strftime('sw_%Y%m%d_%H%M%S_', time.gmtime()) + os.urandom(3).hex()
    doc = {'sweep_id': sid, 'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'count': len(rows), 'chats': rows}
    d = _sweep_dir()
    (d / (sid + '.json')).write_text(json.dumps(doc))
    for old in sorted(d.glob('sw_*.json'))[:-30]:  # keep the last 30 sweeps
        old.unlink(missing_ok=True)
    return {'sweep_id': sid, 'count': len(rows)}


def get_sweep(sweep_id=None):
    d = _sweep_dir()
    if sweep_id:
        if not SWEEP_ID.match(str(sweep_id)):
            raise Problem(400, 'Unknown sweep id.')
        f = d / (sweep_id + '.json')
    else:
        all_ = sorted(d.glob('sw_*.json'))
        f = all_[-1] if all_ else None
    if not f or not f.is_file():
        raise Problem(404, 'No sweep yet: the owner starts one with the Sweep button in the Ready folder.')
    return json.loads(f.read_text())


# ---- Catch me up (switch catch-me-up): the Ready chats and unread notifications the owner had when he tapped it.
# A fresh pull every time: nothing links one catch-up to the one before (Miguel, 20 Nov 2026) ----
CATCHUP_ID = re.compile(r'^cu_[0-9]{8}_[0-9]{6}_[0-9a-f]{6}$')
CATCHUP_KEEP = 30
# wizard-os#758 follow-up: the raw Notifications inbox (~69 unread) is not what he sees in Chats (3); only these count.
CATCHUP_NOTES_SCOPE = ('Only the notifications his Settings > Notifications routing sends to Chats. Others go to badges, the '
                       'Morning Report or off on purpose: never read the Notifications app inbox or report its unread count.')


def _catchup_dir():
    d = DATA / 'catchups'
    d.mkdir(parents=True, exist_ok=True)
    return d


def _catchup_files():
    return sorted(_catchup_dir().glob('cu_*.json'))


def _catchup_read(cid):
    if not CATCHUP_ID.match(str(cid or '')):
        raise Problem(400, 'Unknown catch-up id.')
    f = _catchup_dir() / (cid + '.json')
    if not f.is_file():
        raise Problem(404, 'Unknown catch-up id.')
    return json.loads(f.read_text())


def _catchup_write(doc):
    f = _catchup_dir() / (doc['catchup_id'] + '.json')
    tmp = f.with_suffix('.tmp')
    tmp.write_text(json.dumps(doc))
    tmp.replace(f)


def save_catchup(body):
    chats, notes = body.get('chats', []), body.get('notifications', [])
    if not isinstance(chats, list) or len(chats) > 400:
        raise Problem(400, 'chats must list up to 400 chats.')
    if not isinstance(notes, list) or len(notes) > 200:
        raise Problem(400, 'notifications must list up to 200 items.')
    rows, alerts = [], []
    for it in chats:
        if not isinstance(it, dict) or not isinstance(it.get('id'), str) or not 0 < len(it['id']) <= 120:
            raise Problem(400, 'Each chat needs an id.')
        rows.append({'id': it['id'], 'title': _clip(it.get('title'), 120), 'status': _clip(it.get('status'), 40),
                     'state': _clip(it.get('state'), 20), 'ask': _clip(it.get('ask'), 300), 'preview': _clip(it.get('preview'), 300),
                     'time': _clip(it.get('time'), 40), 'unread': bool(it.get('unread'))})
    for it in notes:
        if not isinstance(it, dict) or not isinstance(it.get('id'), (str, int)) or isinstance(it.get('id'), bool) \
                or not 0 < len(str(it['id'])) <= 120:
            raise Problem(400, 'Each notification needs an id.')
        alerts.append({'id': str(it['id']), 'title': _clip(it.get('title'), 160), 'message': _clip(it.get('message'), 400),
                       'from': _clip(it.get('from'), 60), 'time': _clip(it.get('time'), 40), 'priority': _clip(it.get('priority'), 4)})
    cid = time.strftime('cu_%Y%m%d_%H%M%S_', time.gmtime()) + os.urandom(3).hex()
    doc = {'catchup_id': cid, 'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
           'chats': rows, 'notifications': alerts}
    _catchup_write(doc)
    for old in _catchup_files()[:-CATCHUP_KEEP]:
        old.unlink(missing_ok=True)
    return {'catchup_id': cid, 'chats': len(rows), 'notifications': len(alerts)}


def get_catchup(cid=None):
    """One catch-up (newest without an id): the Ready chats and unread notifications saved when he tapped it."""
    if cid:
        doc = _catchup_read(cid)
    else:
        files = _catchup_files()
        if not files:
            raise Problem(404, 'No catch-up yet: the owner starts one with Catch me up in the Ready folder.')
        doc = json.loads(files[-1].read_text())
    out = {k: doc.get(k) for k in ('catchup_id', 'created', 'chats', 'notifications')}
    out['notifications_scope'] = CATCHUP_NOTES_SCOPE
    return out


def rpc(msg):
    if not isinstance(msg, dict):
        return {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32600, 'message': 'Expected a JSON-RPC object.'}}
    m, i, p = msg.get('method'), msg.get('id'), msg.get('params') or {}
    if 'id' not in msg:
        return None
    try:
        if m == 'initialize':
            r = {'protocolVersion': '2025-06-18', 'capabilities': {'tools': {}}, 'serverInfo': {'name': APP_ID, 'version': VERSION}}
        elif m == 'tools/list':
            r = {'tools': TOOLS}
        elif m == 'tools/call':
            a = p.get('arguments') or {}; n = p.get('name')
            if n == 'habits_list':
                value = list_habits(a.get('day'))
            elif n == 'habits_add':
                value = add_habit(a)
            elif n == 'habits_set_done':
                if not isinstance(a.get('id'), int) or isinstance(a['id'], bool):
                    raise Problem(400, 'id must be an integer.')
                value = set_done(a['id'], a)
            elif n == 'wizard_time':
                value = {'utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            elif n == 'wizard_echo':
                value = {'text': str(a.get('text', ''))}
            elif n == 'sweep_list':
                value = get_sweep(a.get('sweep_id'))
            elif n == 'catchup_list':
                value = get_catchup(a.get('catchup_id'))
            else:
                return {'jsonrpc': '2.0', 'id': i, 'error': {'code': -32602, 'message': 'Unknown tool.'}}
            r = {'content': [{'type': 'text', 'text': json.dumps(value)}], 'structuredContent': value, 'isError': False}
        elif m == 'ping':
            r = {}
        else:
            return {'jsonrpc': '2.0', 'id': i, 'error': {'code': -32601, 'message': 'Unknown method.'}}
    except Problem as e:
        r = {'content': [{'type': 'text', 'text': e.message}], 'isError': True}
    return {'jsonrpc': '2.0', 'id': i, 'result': r}


def _csv(name):
    return {x.strip().lower() for x in os.environ.get(name, '').split(',') if x.strip()}


# Who may talk to this app. Trust never comes from the request itself: the Host must be one this app
# was configured for (stops DNS rebinding), and a browser Origin on writes must be configured too.
# The owner's Wizard gateway, or the local staging helper, passes these in.
_LOOPBACK = {f"127.0.0.1:{os.environ.get('PORT', '8799')}", f"localhost:{os.environ.get('PORT', '8799')}"}
TRUSTED_HOSTS = _csv('WIZARD_TRUSTED_HOSTS') | _LOOPBACK
TRUSTED_ORIGINS = _csv('WIZARD_TRUSTED_ORIGINS') | {'http://' + h for h in _LOOPBACK}


# ---- voice transcripts: the Transcriber app hears a voice message once; the words are kept here for every device ----
TRANSCRIBER = os.environ.get('TRANSCRIBER_URL', 'http://transcriber:8000').rstrip('/')
TX_FILE = DATA / 'transcripts.json'
TX_MAX_AUDIO = 25 * 1024 * 1024
TX_KEEP = 3000


def _tx_key(value):
    k = str(value or '')
    if not (k.startswith('/wizard/files/') or k.startswith('/wizard/attachments/')) or len(k) > 240 or any(c in k for c in '\r\n\\"<>'):
        raise Problem(400, 'Unknown voice message.')
    return k


def _tx_load():
    try:
        d = json.loads(TX_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _tx_save(d):
    DATA.mkdir(parents=True, exist_ok=True)
    keys = list(d)
    for k in keys[:max(0, len(keys) - TX_KEEP)]:
        d.pop(k, None)
    tmp = TX_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(d))
    os.chmod(tmp, 0o600)
    tmp.replace(TX_FILE)


def transcripts(keys):
    d = _tx_load()
    out = {}
    for k in keys[:60]:
        if isinstance(k, str) and isinstance(d.get(k), str):
            out[k] = d[k]
    return {'transcripts': out}


def transcribe(key, audio, mime):
    import urllib.error
    import urllib.request
    import uuid
    key = _tx_key(key)
    if not audio:
        raise Problem(400, 'No audio.')
    ext = {'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav'}.get(mime, 'webm')
    b = uuid.uuid4().hex
    parts = []
    for name, value in (('model', os.environ.get('TRANSCRIBER_MODEL', 'Systran/faster-whisper-small')), ('response_format', 'json')):
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="voice.{ext}"\r\nContent-Type: {mime or "audio/webm"}\r\n\r\n'.encode() + audio + b'\r\n')
    parts.append(f'--{b}--\r\n'.encode())
    req = urllib.request.Request(TRANSCRIBER + '/v1/audio/transcriptions', data=b''.join(parts), method='POST', headers={'Content-Type': f'multipart/form-data; boundary={b}'})
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            text = str(json.loads(r.read()).get('text') or '').strip()
    except urllib.error.HTTPError as e:
        raise Problem(502, f'Transcriber answered {e.code}.') from None
    except (urllib.error.URLError, OSError, ValueError):
        raise Problem(503, 'Get the Transcriber app to see the words of voice messages.') from None
    d = _tx_load()
    d.pop(key, None)
    d[key] = text[:8000]
    _tx_save(d)
    return {'text': d[key]}


class Handler(BaseHTTPRequestHandler):
    def refused(self, write=False):
        if (self.headers.get('Host') or '').lower() not in TRUSTED_HOSTS:
            self.send(403, {'error': 'Unknown host.'})
            return True
        if write:
            origin = (self.headers.get('Origin') or '').lower()
            if origin and origin not in TRUSTED_ORIGINS:
                self.send(403, {'error': 'Cross-origin writes refused.'})
                return True
            if not origin and (self.headers.get('Sec-Fetch-Site') or '') == 'cross-site':
                self.send(403, {'error': 'Cross-origin writes refused.'})
                return True
        return False

    def send(self, code, body=None, content_type='application/json'):
        b = body if isinstance(body, bytes) else b'' if body is None else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(b)

    def do_GET(self):
        if self.refused():
            return
        path = urlsplit(self.path).path
        if path == '/healthz':
            return self.send(200, {'ok': True, 'app': APP_ID, 'version': VERSION})
        if path == '/api/habits':
            try:
                return self.send(200, list_habits(parse_qs(urlsplit(self.path).query).get('day', [None])[0]))
            except Problem as e:
                return self.send(e.code, {'error': e.message})
        if path == '/api/transcripts':
            try:
                keys = json.loads(parse_qs(urlsplit(self.path).query).get('keys', ['[]'])[0])
                return self.send(200, transcripts(keys if isinstance(keys, list) else []))
            except ValueError:
                return self.send(400, {'error': 'keys must be a JSON list.'})
        if path == '/api/features':
            # Which switches are on, for this app's own page (read-only; changing one stays owner-only /api/switches).
            return self.send(200, {s['id']: s['on'] for s in switches_doc()['switches']})
        if path == '/api/time':
            return self.send(200, {'utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
        # The view: any file directly in web/, by an allowlisted type. No subpaths, no dotfiles.
        name = 'index.html' if path == '/' else path[1:]
        kind = STATIC_TYPES.get(Path(name).suffix)
        if kind and '/' not in name and not name.startswith('.') and (ROOT / 'web' / name).is_file():
            return self.send(200, (ROOT / 'web' / name).read_bytes(), kind)
        if path == '/openapi.json':
            return self.send(200, (ROOT / 'openapi.json').read_bytes())
        self.send(405 if path == '/mcp' else 404, {'error': 'Use POST /mcp.' if path == '/mcp' else 'Not found.'})

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if self.refused(write=True):
            return
        path = urlsplit(self.path).path
        if path == '/api/transcribe':
            try:
                mime = self.headers.get('Content-Type', '').split(';')[0].strip().lower()
                if not mime.startswith('audio/'):
                    return self.send(415, {'error': 'Send the voice message audio.'})
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= TX_MAX_AUDIO:
                    return self.send(413, {'error': 'Voice message too large.'})
                key = parse_qs(urlsplit(self.path).query).get('key', [''])[0]
                _tx_key(key)
                return self.send(200, transcribe(key, self.rfile.read(size), mime))
            except Problem as e:
                return self.send(e.code, {'error': e.message})
            except ValueError:
                return self.send(400, {'error': 'Invalid request.'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send(415, {'error': 'Use application/json.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 <= size <= (524288 if path in ('/api/sweep', '/api/catchup') else 65536):  # these carry the whole Ready list
                return self.send(413, {'error': 'Request too large.'})
            body = json.loads(self.rfile.read(size))
            if path == '/mcp':
                if not isinstance(body, dict):
                    return self.send(400, {'error': 'Expected a JSON-RPC object.'})
                out = rpc(body)
                return self.send(202 if out is None else 200, out)
            if not isinstance(body, dict):
                return self.send(400, {'error': 'Expected a JSON object.'})
            if path == '/api/habits':
                return self.send(201, add_habit(body))
            if path.startswith('/api/habits/') and path.endswith('/today'):
                parts = path.split('/')
                if len(parts) != 5 or not parts[3].isdigit():
                    raise Problem(400, 'Invalid habit id.')
                return self.send(200, set_done(int(parts[3]), body))
            if path == '/api/echo':
                return self.send(200, {'text': str(body.get('text', ''))})
            if path == '/api/sweep':
                return self.send(201, save_sweep(body))
            if path == '/api/catchup':
                if not switch_on('catch-me-up'):
                    return self.send(404, {'error': 'Catch me up is switched off.'})
                return self.send(201, save_catchup(body))
            self.send(404, {'error': 'Not found.'})
        except Problem as e:
            self.send(e.code, {'error': e.message})
        except (ValueError, TypeError, AttributeError):
            self.send(400, {'error': 'Invalid JSON request.'})

    def log_message(self, format, *args):
        pass


# ---- wizard.app-switches/1 ------------------------------------------------------------------------------------------
# Owner feature switches for the Tracker's Try it (wizard-os docs/APP_SWITCHES.md). Shared block: the same text ships in
# every Wizard app; `wam new` starts every app with it (wizard-os AGENTS.md: a new app repo ships it in its first PR). Every new feature ships behind a switch, off by
# default: append it to SWITCHES with the issue it delivers, e.g.
#   {'id': 'compact-header', 'name': 'Compact top bar', 'description': '...', 'default': False,
#    'issues': ['humanitylabs-org/<repo>#20']}
# and gate the feature on switch_on('compact-header'). State lives on the box (DATA_DIR/switches.json), so the app's
# page, the Tracker (through the App Manager) and the agent see one state. GET/POST /api/switches, owner only, with
# X-Wizard-Switch: 1 and never a bearer or agent grant. An app with a platform owner-proof key (owner_proof in wizard.md,
# wizard-os spec/OWNER_PROOF.md) accepts only a valid signed proof: any process on the box can set the other headers.
# An app without one accepts the box's Tailscale Serve owner login, never a box-local host.
import hashlib as _sw_hashlib
import hmac as _sw_hmac
import json as _sw_json
import os as _sw_os
import re as _sw_re
import threading as _sw_threading
import time as _sw_time
from pathlib import Path as _SwPath
from urllib.parse import urlsplit as _sw_urlsplit

SWITCHES = [
    {'id': 'ready-total', 'name': 'Ready shows its total',
     'description': "The Ready tab shows how many chats are in Ready, read or unread; the same number rides on the app's badge "
                    "in Wizard's app list while the app is open.",
     'default': False, 'issues': ['humanitylabs-org/telegram#5']},
    {'id': 'ready-sweep', 'name': 'Sweep button',
     'description': 'A Sweep button in the Ready folder opens a new chat where your agent walks you through every Ready chat '
                    'in sensible chunks, so you can archive, answer or keep them in bulk.',
     'default': False, 'issues': ['humanitylabs-org/telegram#5']},
    {'id': 'catch-me-up', 'name': 'Catch me up',
     'description': 'In the Ready folder, Sweep becomes Catch me up: one tap starts a catch-up chat in the background (the button spins '
                    'while it runs). When it is done it lands in Ready with everything waiting on you across your '
                    'apps in two steps: first one numbered Clear all list you answer with "clear" (or "clear except 7"), then the items '
                    'that need you, a few at a time per app, each with two short sentences of context and a yes/no question. Only '
                    'notifications routed to Chats count; Messenger reels, videos and links stay unread on a "to watch" line. '
                    'Catch-up replies always show in full.',
     'default': False, 'issues': ['humanitylabs-org/telegram#7', 'humanitylabs-org/wizard-os#758']},
    {'id': 'fuel-gauge', 'name': 'AI fuel gauge',
     'description': 'The AI fuel gauge from the desktop sidebar (E, ten cells, F) sits at the bottom of the chat list with the '
                    'same reading. Tap it for the same AI usage page: your subscriptions, which are selected and how much is left.',
     'default': False, 'issues': ['humanitylabs-org/telegram#54']},
]
_SW_CONTRACT = 'wizard.app-switches/1'
_SW_ROUTE = _sw_re.compile(r'(?:/[a-z0-9][a-z0-9-]{0,62})?/api/switches/?')
_SW_LOCAL = {'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'}
_sw_lock = _sw_threading.Lock()
_sw_nonces = {}
_SW_PROOF = _sw_re.compile(r'(\d{1,12})\.([0-9a-f]{48})\.([0-9a-f]{64})')


def _sw_file():
    return _SwPath(_sw_os.environ.get('WIZARD_SWITCHES_DIR') or DATA) / 'switches.json'


def _sw_saved():
    try:
        saved = _sw_json.loads(_sw_file().read_text())
    except (OSError, ValueError):
        return {}
    return saved if isinstance(saved, dict) else {}


def switches_doc():
    saved = _sw_saved()
    return {'contract': _SW_CONTRACT, 'switches': [
        dict(s, on=saved[s['id']] if isinstance(saved.get(s['id']), bool) else bool(s.get('default'))) for s in SWITCHES]}


def switch_on(switch_id):
    return next((s['on'] for s in switches_doc()['switches'] if s['id'] == switch_id), False)


def _sw_set(switch_id, on):
    with _sw_lock:
        ids = {s['id'] for s in SWITCHES}
        saved = {k: v for k, v in _sw_saved().items() if k in ids and isinstance(v, bool)}
        saved[switch_id] = on
        f = _sw_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_name(f.name + '.tmp')
        tmp.write_text(_sw_json.dumps(saved))
        _sw_os.replace(tmp, f)
    return switches_doc()


def _sw_proof(h):
    """None when this app has no platform owner-proof key, else whether the request carries a valid, unused proof."""
    key_file = _sw_os.environ.get('WIZARD_OWNER_PROOF_KEY_FILE')
    if not key_file:
        return None
    try:
        with open(key_file, 'rb') as f:
            key = f.read(33)
    except OSError:
        return False                    # a key is named but unreadable: refuse, never fall back to headers
    app = _sw_os.environ.get('WIZARD_OWNER_PROOF_APP') or ''
    values = h.headers.get_all('X-Wizard-App-Owner-Proof') or []
    m = _SW_PROOF.fullmatch(values[0].strip()) if len(values) == 1 else None
    if len(key) != 32 or not app or not m or abs(_sw_time.time() - int(m.group(1))) > 30:
        return False
    msg = '\n'.join(('wizard-app-owner-v1', app, m.group(1), m.group(2), h.command, h.path)).encode()
    if not _sw_hmac.compare_digest(_sw_hmac.new(key, msg, _sw_hashlib.sha256).hexdigest(), m.group(3)):
        return False
    now = _sw_time.monotonic()
    with _sw_lock:
        for n in [n for n, until in _sw_nonces.items() if until < now]:
            del _sw_nonces[n]
        if m.group(2) in _sw_nonces:
            return False
        _sw_nonces[m.group(2)] = now + 60
    return True


def _sw_owner(h, write):
    hd = h.headers
    if hd.get('Authorization') or hd.get('X-Wizard-Switch') != '1':
        return False
    proof = _sw_proof(h)
    if proof is not None:
        return proof
    if (hd.get('Sec-Fetch-Site') or 'same-origin').lower() not in ('same-origin', 'none'):
        return False
    host = (hd.get('Host') or '').strip().lower()
    name = host.split(']')[0] + ']' if host.startswith('[') else host.rsplit(':', 1)[0]
    if not name or name in _SW_LOCAL or '.' not in name:      # box-local and container hosts never prove the owner
        return False
    origin = hd.get('Origin')
    trusted = {o.strip() for o in (_sw_os.environ.get('WIZARD_TRUSTED_ORIGINS') or '').split(',') if o.strip()}
    if origin and _sw_urlsplit(origin).netloc.lower() != host and origin not in trusted:
        return False
    if write and not origin:
        return False
    logins = [x.strip() for x in (hd.get_all('Tailscale-User-Login') or [])]
    owners = {x.strip().lower() for x in (_sw_os.environ.get('WIZARD_OWNER_LOGINS') or '').split(',') if x.strip()}
    return len(logins) == 1 and '@' in logins[0] and (not owners or logins[0].lower() in owners)


def _sw_send(h, code, doc):
    body = _sw_json.dumps(doc).encode()
    h.send_response(code)
    h.send_header('Content-Type', 'application/json')
    h.send_header('Cache-Control', 'no-store')
    h.send_header('Content-Length', str(len(body)))
    h.end_headers()
    if h.command != 'HEAD':
        h.wfile.write(body)


def _sw_handle(h):
    """Serve /api/switches (or /<app>/api/switches) and return True; False for every other request."""
    if not _SW_ROUTE.fullmatch(_sw_urlsplit(h.path).path):
        return False
    if h.command in ('GET', 'HEAD'):
        if not _sw_owner(h, False):
            _sw_send(h, 403, {'error': "Only this Wizard's owner can see these switches.", 'code': 'owner_only'})
        else:
            _sw_send(h, 200, switches_doc())
        return True
    if not _sw_owner(h, True):
        _sw_send(h, 403, {'error': "Only this Wizard's owner can change these switches.", 'code': 'owner_only'})
        return True
    try:
        if (h.headers.get('Content-Type') or '').split(';')[0].strip() != 'application/json':
            raise ValueError
        size = int(h.headers.get('Content-Length') or '0')
        if size <= 0 or size > 4096:
            raise ValueError
        body = _sw_json.loads(h.rfile.read(size))
        if not isinstance(body, dict) or not isinstance(body.get('id'), str) or not isinstance(body.get('on'), bool) \
                or set(body) - {'id', 'on'}:
            raise ValueError
    except (ValueError, TypeError):
        _sw_send(h, 400, {'error': 'Send JSON {"id": "...", "on": true|false}', 'code': 'invalid_input'})
        return True
    if body['id'] not in {s['id'] for s in SWITCHES}:
        _sw_send(h, 404, {'error': 'No such switch', 'code': 'unknown_switch'})
        return True
    try:
        _sw_send(h, 200, _sw_set(body['id'], body['on']))
    except OSError:
        _sw_send(h, 500, {'error': 'storage_failure'})
    return True


def wizard_switches_install(handler_cls):
    """Route the switch endpoint ahead of the app's own GET/HEAD/POST handlers."""
    for method in ('do_GET', 'do_HEAD', 'do_POST'):
        orig = getattr(handler_cls, method, None)
        if getattr(orig, '_wizard_switches', False):
            continue

        def wrapped(self, _orig=orig):
            if _sw_handle(self):
                return None
            if _orig is None:
                return self.send_error(501)
            return _orig(self)
        wrapped._wizard_switches = True
        setattr(handler_cls, method, wrapped)
    return handler_cls
# ---- end wizard.app-switches/1 ---------------------------------------------------------------------------------------


wizard_switches_install(Handler)


# Switches that were approved and removed (the feature is simply on now): their stored value is cleared.
RETIRED_SWITCHES = ('newest-preview', 'numbered-models')   # telegram#1, telegram#13


def clear_retired_switches():
    with _sw_lock:
        saved = _sw_saved()
        if not any(k in saved for k in RETIRED_SWITCHES):
            return
        f = _sw_file()
        tmp = f.with_name(f.name + '.tmp')
        tmp.write_text(json.dumps({k: v for k, v in saved.items() if k not in RETIRED_SWITCHES}))
        os.replace(tmp, f)


if __name__ == '__main__':
    connect().close()
    try:
        clear_retired_switches()
    except OSError:
        pass
    ThreadingHTTPServer((os.environ.get('BIND', '0.0.0.0'), int(os.environ.get('PORT', '8799'))), Handler).serve_forever()
