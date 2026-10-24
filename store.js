// 資料層：房間格局與照片。本機透過 serve.py 存進專案資料夾；雲端（Vercel）存進 Blob。localStorage 只當備援。
// 房間由一個或多個矩形（rects）組成，所以可以是 L 型、凹字型等。座標單位：公尺，對齊 0.25 m 格線。
const KEY = 'home-twin:v2';
const KEYS = [KEY, 'home-twin:v1'];
const Q = 4; // 每公尺 4 格（0.25 m）

export const uid = () => Math.random().toString(36).slice(2, 9);
export const snap = (v, s = 1 / Q) => Math.round(v / s) * s;

// 預設格局＝2026-10-24 調整好的版本（備份也在 home-data.json）
const SAVED = {"rooms": [{"id": "living", "name": "客廳", "color": "#f6d6a8", "rects": [{"x": 5, "y": 9, "w": 4, "h": 3}]}, {"id": "kitchen", "name": "廚房", "color": "#c9e4c5", "rects": [{"x": 0, "y": 5, "w": 4, "h": 3}]}, {"id": "dining", "name": "餐廳", "color": "#f3e1b6", "rects": [{"x": 5, "y": 7, "w": 4, "h": 2}]}, {"id": "master", "name": "主臥", "color": "#e2cdf0", "rects": [{"x": 5, "y": -1, "w": 4, "h": 4.75}, {"x": 9, "y": -1, "w": 1, "h": 6}]}, {"id": "room2", "name": "次臥", "color": "#e2cdf0", "rects": [{"x": -1, "y": 1, "w": 2, "h": 4}, {"x": 1, "y": 1, "w": 3, "h": 1}]}, {"id": "bath", "name": "浴室", "color": "#bfe3ea", "rects": [{"x": 1, "y": 2, "w": 3, "h": 3}]}, {"id": "balcony", "name": "陽台", "color": "#dcdccb", "rects": [{"x": 4, "y": 12, "w": 6, "h": 1}, {"x": 9, "y": 7, "w": 1, "h": 6}]}, {"id": "entry", "name": "玄關", "color": "#e5e7eb", "rects": [{"x": 0, "y": 9, "w": 4, "h": 3}]}, {"id": "room3", "name": "次臥", "color": "#e2cdf0", "rects": [{"x": 0, "y": -1, "w": 5, "h": 2}]}, {"id": "hall", "name": "走道", "color": "#e5e7eb", "rects": [{"x": 4, "y": 1, "w": 1, "h": 11}]}, {"id": "room4", "name": "次臥", "color": "#e2cdf0", "rects": [{"x": 5, "y": 5, "w": 4, "h": 2}]}, {"id": "backyard", "name": "陽台", "color": "#dcdccb", "rects": [{"x": -1, "y": 5, "w": 1, "h": 3}]}, {"id": "eqemdn9", "name": "儲藏室", "color": "#e5e7eb", "rects": [{"x": 0, "y": 8, "w": 4, "h": 1}]}, {"id": "12bhiiz", "name": "浴室", "color": "#bfe3ea", "rects": [{"x": 5, "y": 3.75, "w": 4, "h": 1.25}]}]};

function defaults() {
  return normalize(structuredClone(SAVED));
}

// 舊格式（x,y,w,h）→ rects
export function normalize(s) {
  const rooms = s.rooms.map((r) => {
    const { x, y, w, h, ...rest } = r;
    return { ...rest, rects: r.rects?.length ? r.rects : [{ x, y, w, h }] };
  });
  return { rooms, photos: Array.isArray(s.photos) ? s.photos : [], savedAt: s.savedAt || 0 };
}

function load() {
  for (const k of KEYS) { // 升級後讀不到新版資料時，沿用舊版的
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (s && Array.isArray(s.rooms)) return normalize(s);
    } catch {}
  }
  return defaults();
}

const listeners = new Set();
const statusListeners = new Set();
const EDIT_KEY = 'home-twin:edit-key';
let serverMode = false;
let saveTimer = null;
let saveStatus = 'local'; // saved | saving | local | error | readonly

// 雲端版（Vercel）需要編輯密碼；本機 serve.py 不需要
export const access = { needsKey: false, canEdit: true };

function setStatus(v) { saveStatus = v; statusListeners.forEach((f) => f(v)); }
export function onSaveStatus(fn) { statusListeners.add(fn); fn(saveStatus); }

const editKey = () => { try { return localStorage.getItem(EDIT_KEY) || ''; } catch { return ''; } };
export function api(url, opts = {}) {
  return fetch(url, { cache: 'no-store', ...opts, headers: { ...opts.headers, 'x-edit-key': editKey() } });
}

async function loadAccess() {
  const r = await api('/api/config');
  if (r.ok) Object.assign(access, await r.json());
}

// 輸入編輯密碼：對了就記在這個瀏覽器
export async function unlock(key) {
  try { localStorage.setItem(EDIT_KEY, key); } catch {}
  await loadAccess();
  if (!access.canEdit) { try { localStorage.removeItem(EDIT_KEY); } catch {} }
  return access.canEdit;
}

export function lock() {
  try { localStorage.removeItem(EDIT_KEY); } catch {}
  access.canEdit = !access.needsKey;
  setStatus(access.canEdit ? 'saved' : 'readonly');
}

function pushToServer() {
  clearTimeout(saveTimer);
  setStatus('saving');
  saveTimer = setTimeout(async () => {
    try {
      const r = await api('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(store.state) });
      if (!r.ok) throw new Error(r.status);
      setStatus('saved');
    } catch { setStatus('error'); }
  }, 400);
}

function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(store.state)); } catch {}
}

export const store = {
  state: load(),
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  update(fn) {
    if (!access.canEdit) return; // 唯讀：不改、不存
    fn(this.state);
    this.state.savedAt = Date.now();
    saveLocal();
    if (serverMode) pushToServer();
    listeners.forEach((l) => l(this.state));
  },
  replace(next) { this.state = normalize(next); this.update(() => {}); },
};

// 啟動時跟伺服器同步：以比較新的那份為準；唯讀時一律用伺服器的
export async function initStore() {
  try {
    await loadAccess().catch(() => {});
    const r = await api('/api/data');
    if (r.status === 404) { serverMode = true; if (access.canEdit) pushToServer(); return; }
    if (!r.ok) throw new Error(r.status);
    const remote = normalize(await r.json());
    serverMode = true;
    if (!access.canEdit) { store.state = remote; setStatus('readonly'); return; }
    const hasLocal = KEYS.some((k) => localStorage.getItem(k));
    const rt = remote.savedAt || 0;
    const lt = hasLocal ? store.state.savedAt || 0 : -1;
    if (rt > lt) { store.state = remote; saveLocal(); setStatus('saved'); }
    else if (rt === lt && rt > 0) setStatus('saved');
    else pushToServer();
  } catch {
    setStatus('local'); // 沒有伺服器（直接開檔案）：只能存在瀏覽器
  }
}

// ---------- 幾何 ----------
const inRect = (q, x, y) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;
export const roomContains = (r, x, y) => r.rects.some((q) => inRect(q, x, y));
export const roomArea = (r) => {
  const cells = cellSet(r);
  return cells.size / (Q * Q);
};
// 主矩形（面積最大）的中心：放標籤、全景拍攝點
export function roomCenter(r) {
  const q = r.rects.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  return { x: q.x + q.w / 2, y: q.y + q.h / 2 };
}

export function roomAt(s, x, y) {
  let best = null;
  for (const r of s.rooms) {
    if (roomContains(r, x, y) && (!best || roomArea(r) < roomArea(best))) best = r;
  }
  return best;
}

export function bounds(rooms) {
  const rs = rooms.flatMap((r) => r.rects);
  if (!rs.length) return { minX: 0, minY: 0, maxX: 8, maxY: 6 };
  return {
    minX: Math.min(...rs.map((q) => q.x)),
    minY: Math.min(...rs.map((q) => q.y)),
    maxX: Math.max(...rs.map((q) => q.x + q.w)),
    maxY: Math.max(...rs.map((q) => q.y + q.h)),
  };
}

function cellSet(r) {
  const set = new Set();
  for (const q of r.rects) {
    const i0 = Math.round(q.x * Q), i1 = Math.round((q.x + q.w) * Q);
    const j0 = Math.round(q.y * Q), j1 = Math.round((q.y + q.h) * Q);
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) set.add(`${i},${j}`);
  }
  return set;
}

// 多個房間合起來的面積（重疊的部分只算一次）
export function totalArea(rooms) {
  const all = new Set();
  for (const r of rooms) for (const c of cellSet(r)) all.add(c);
  return all.size / (Q * Q);
}

// 房間外框（矩形聯集的邊界），合併成最長的直線段：[{x1,y1,x2,y2}]
export function outlineSegments(r) {
  const cells = cellSet(r);
  const hor = new Map(), ver = new Map();
  const push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
  for (const key of cells) {
    const [i, j] = key.split(',').map(Number);
    if (!cells.has(`${i},${j - 1}`)) push(hor, j, i);
    if (!cells.has(`${i},${j + 1}`)) push(hor, j + 1, i);
    if (!cells.has(`${i - 1},${j}`)) push(ver, i, j);
    if (!cells.has(`${i + 1},${j}`)) push(ver, i + 1, j);
  }
  const segs = [];
  const merge = (m, mk) => {
    for (const [k, list] of m) {
      list.sort((a, b) => a - b);
      let start = list[0], prev = list[0];
      for (let n = 1; n <= list.length; n++) {
        if (list[n] === prev + 1) { prev = list[n]; continue; }
        segs.push(mk(k / Q, start / Q, (prev + 1) / Q));
        start = prev = list[n];
      }
    }
  };
  merge(hor, (y, a, b) => ({ x1: a, y1: y, x2: b, y2: y }));
  merge(ver, (x, a, b) => ({ x1: x, y1: a, x2: x, y2: b }));
  return segs;
}

export function outlinePath(r) {
  return outlineSegments(r).map((s) => `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`).join('');
}

export function adjacentRooms(s, room) {
  const eps = 0.05;
  const touch = (a, b) => {
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    const v = (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) && oy > 0.3;
    const h = (Math.abs(a.y + a.h - b.y) < eps || Math.abs(b.y + b.h - a.y) < eps) && ox > 0.3;
    return v || h;
  };
  return s.rooms.filter((b) => b.id !== room.id && room.rects.some((a) => b.rects.some((q) => touch(a, q))));
}

// ---------- 動作 ----------
export function moveRoom(id, dx, dy) {
  store.update((s) => {
    const r = s.rooms.find((r) => r.id === id);
    if (!r) return;
    const inside = s.photos.filter((p) => roomAt(s, p.x, p.y)?.id === id);
    r.rects.forEach((q) => { q.x = snap(q.x + dx); q.y = snap(q.y + dy); });
    inside.forEach((p) => { p.x += dx; p.y += dy; });
  });
}

export function updateRect(id, idx, rect) {
  store.update((s) => {
    const r = s.rooms.find((r) => r.id === id);
    if (r?.rects[idx]) r.rects[idx] = { x: snap(rect.x), y: snap(rect.y), w: Math.max(0.5, snap(rect.w)), h: Math.max(0.5, snap(rect.h)) };
  });
}

export function updateRoom(id, patch) {
  store.update((s) => Object.assign(s.rooms.find((r) => r.id === id) || {}, patch));
}

// L 型延伸：在主矩形右下方接一段，之後再拖邊調整
export function addSegment(id) {
  store.update((s) => {
    const r = s.rooms.find((r) => r.id === id);
    if (!r) return;
    const q = r.rects[0];
    r.rects.push({ x: snap(q.x + q.w), y: snap(q.y + q.h - Math.min(1.5, q.h)), w: 2, h: snap(Math.min(1.5, q.h)) });
  });
}

export function removeSegment(id) {
  store.update((s) => {
    const r = s.rooms.find((r) => r.id === id);
    if (r && r.rects.length > 1) r.rects.pop();
  });
}

export function addRoom() {
  const id = uid();
  store.update((s) => {
    const b = bounds(s.rooms);
    s.rooms.push({ id, name: '新房間', color: '#e5e7eb', rects: [{ x: snap(b.maxX), y: snap(b.minY), w: 3, h: 3 }] });
  });
  return id;
}

export function deleteRoom(id) {
  store.update((s) => { s.rooms = s.rooms.filter((r) => r.id !== id); });
}

// ---------- 照片 ----------
// 照片：{ id, file, x, y, heading（度，0＝朝右/東，順時針）, caption, t }
export function addPhotos(list) {
  store.update((s) => { s.photos.push(...list); });
}

export function updatePhoto(id, patch) {
  store.update((s) => Object.assign(s.photos.find((p) => p.id === id) || {}, patch));
}

export function deletePhoto(id) {
  const p = store.state.photos.find((p) => p.id === id);
  store.update((s) => { s.photos = s.photos.filter((x) => x.id !== id); });
  if (p) api('/api/photos?file=' + encodeURIComponent(p.file), { method: 'DELETE' }).catch(() => {});
}

export const photosIn = (s, roomId) => s.photos.filter((p) => (roomAt(s, p.x, p.y)?.id ?? null) === roomId);

// 縮到長邊 2560px 的 JPEG 後上傳，回傳 photos/xxx.jpg
export async function uploadPhoto(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  const r = await api('/api/photos?ext=jpg', { method: 'POST', body: blob });
  if (!r.ok) throw new Error('upload failed');
  return (await r.json()).file;
}
