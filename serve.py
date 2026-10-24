# 本機伺服器：提供網頁（不快取），並把格局與照片直接存進專案資料夾
#   GET  /api/data           讀 home-data.json
#   PUT  /api/data           寫 home-data.json（每天第一次寫入前先備份到 backups/）
#   POST /api/photos?ext=jpg 存一張照片到 photos/，回傳路徑
#   DELETE /api/photos?file=… 把照片移到 photos/.trash（不會真的刪掉）
#   GET  /api/config         本機不需要編輯密碼
import http.server, json, os, shutil, sys, time, uuid
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, 'home-data.json')
PHOTOS = os.path.join(ROOT, 'photos')
TRASH = os.path.join(PHOTOS, '.trash')
BACKUPS = os.path.join(ROOT, 'backups')
EXTS = {'jpg', 'jpeg', 'png', 'webp'}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        return self.rfile.read(int(self.headers.get('Content-Length', 0)))

    def do_GET(self):
        if urlparse(self.path).path == '/api/config':
            return self.send_json(200, {'needsKey': False, 'canEdit': True})
        if urlparse(self.path).path == '/api/data':
            if not os.path.exists(DATA):
                return self.send_json(404, {})
            with open(DATA, encoding='utf-8') as f:
                return self.send_json(200, json.load(f))
        super().do_GET()

    def do_PUT(self):
        if urlparse(self.path).path != '/api/data':
            return self.send_json(404, {})
        try:
            data = json.loads(self.read_body())
            assert isinstance(data.get('rooms'), list)
        except Exception:
            return self.send_json(400, {'error': 'invalid data'})
        if os.path.exists(DATA):
            os.makedirs(BACKUPS, exist_ok=True)
            daily = os.path.join(BACKUPS, time.strftime('home-data-%Y%m%d.json'))
            if not os.path.exists(daily):
                shutil.copy2(DATA, daily)
        tmp = DATA + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA)
        self.send_json(200, {'ok': True})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != '/api/photos':
            return self.send_json(404, {})
        ext = parse_qs(u.query).get('ext', ['jpg'])[0].lower()
        if ext not in EXTS:
            return self.send_json(400, {'error': 'unsupported type'})
        os.makedirs(PHOTOS, exist_ok=True)
        name = time.strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6] + '.' + ext
        with open(os.path.join(PHOTOS, name), 'wb') as f:
            f.write(self.read_body())
        self.send_json(200, {'file': 'photos/' + name})

    def do_DELETE(self):
        u = urlparse(self.path)
        if u.path != '/api/photos':
            return self.send_json(404, {})
        name = os.path.basename(unquote(parse_qs(u.query).get('file', [''])[0]))
        src = os.path.join(PHOTOS, name)
        if os.path.isfile(src):
            os.makedirs(TRASH, exist_ok=True)
            shutil.move(src, os.path.join(TRASH, name))
        self.send_json(200, {'ok': True})


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
print(f'屁眼派對 · 數位分身：http://localhost:{port}')
http.server.ThreadingHTTPServer(('', port), Handler).serve_forever()
