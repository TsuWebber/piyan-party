import {
  store, initStore, onSaveStatus, roomAt, roomArea, totalArea, bounds, snap, uid, moveRoom, updateRoom, updateRect,
  addRoom, deleteRoom, addSegment, removeSegment, addPhotos, updatePhoto, deletePhoto, photosIn, uploadPhoto,
  access, unlock, lock,
} from './store.js';
import { createPlan } from './plan.js';
import { createHouse } from './house3d.js';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

await initStore();

let editing = false;
let currentView = 'plan';
let houseDirty = true;
let selectedPhoto = null;

// ---------- 顯示設定（單位、名稱、大小）：每個瀏覽器自己記 ----------
const PING = 3.305785; // 1 坪 = 3.305785 m²
const DISPLAY_KEY = 'home-twin:display';
const display = { unit: 'ping', names: true, area: true };
try { Object.assign(display, JSON.parse(localStorage.getItem(DISPLAY_KEY)) || {}); } catch {}
const fmtArea = (m2, unit = display.unit) => (unit === 'ping' ? `${(m2 / PING).toFixed(1)} 坪` : `${m2.toFixed(1)} m²`);
const isBalcony = (r) => /陽台|露台/.test(r.name);

function setDisplay(patch) {
  Object.assign(display, patch);
  try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(display)); } catch {}
  renderSummary(store.state);
  renderSidebar(store.state);
  plan.render();
  houseDirty = true;
  if (currentView === '3d') { house.rebuild(store.state, display); houseDirty = false; }
}

function renderSummary(s) {
  const all = totalArea(s.rooms);
  const indoor = totalArea(s.rooms.filter((r) => !isBalcony(r)));
  const balcony = totalArea(s.rooms.filter(isBalcony));
  const b = bounds(s.rooms);
  const other = display.unit === 'ping' ? 'm2' : 'ping';
  $('#total-main').textContent = fmtArea(all);
  $('#total-alt').textContent = `＝ ${fmtArea(all, other)}`;
  $('#total-breakdown').innerHTML = `
    <dt>室內</dt><dd>${fmtArea(indoor)}</dd>
    <dt>陽台</dt><dd>${fmtArea(balcony)}</dd>
    <dt>外框尺寸</dt><dd>${(b.maxX - b.minX).toFixed(2)} × ${(b.maxY - b.minY).toFixed(2)} m</dd>
    <dt>房間數</dt><dd>${s.rooms.length} 間</dd>`;
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('active', x.dataset.unit === display.unit));
  $('#opt-names').checked = display.names;
  $('#opt-area').checked = display.area;
}

// ---------- 小工具 ----------
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}
const fmtDate = (t) => new Date(t).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' });
const roomName = (s, ph) => roomAt(s, ph.x, ph.y)?.name ?? '屋外';

// 內建瀏覽器會擋掉原生 confirm()，改用自己的確認視窗
function ask(msg, okLabel = '刪除') {
  return new Promise((resolve) => {
    const d = $('#ask');
    $('#ask-msg').textContent = msg;
    $('#ask-ok').textContent = okLabel;
    // 直接在按鈕點擊時決定，不只靠 close 事件（背景分頁可能延遲觸發）
    $('#ask-ok').onclick = () => resolve(true);
    d.onclose = () => resolve(d.returnValue === 'yes');
    d.returnValue = '';
    d.showModal();
  });
}

onSaveStatus((st) => {
  const el = $('#save-status');
  el.textContent = {
    saved: access.needsKey ? '✓ 已存到雲端' : '✓ 已存到專案資料夾', saving: '儲存中…', readonly: '👀 唯讀',
    local: '⚠ 只存在瀏覽器（請用 serve.py 開啟）', error: '⚠ 存檔失敗，請檢查網路或伺服器',
  }[st];
  el.classList.toggle('error', st === 'error' || st === 'local');
});

// 唯讀 / 可編輯的畫面切換
function applyAccess() {
  document.body.classList.toggle('readonly', !access.canEdit);
  $('#btn-unlock').hidden = !(access.needsKey && !access.canEdit);
  $('#btn-lock').hidden = !(access.needsKey && access.canEdit);
  $('#v-caption').readOnly = !access.canEdit;
  $('#v-caption').placeholder = access.canEdit ? '加個說明，例如：書櫃第二層放工具' : '';
  if (!access.canEdit) $('#plan-hint').textContent = '點 📷 看照片 · 雙擊房間看那個房間的照片';
}
$('#btn-unlock').onclick = () => {
  openDialog({
    title: '輸入編輯密碼',
    fields: [{ key: 'key', label: '編輯密碼', type: 'password', required: true }],
    onSave: async ({ key }) => {
      if (await unlock(key)) { location.reload(); }
      else toast('密碼不對');
    },
  });
};
$('#btn-lock').onclick = () => { lock(); location.reload(); };

// ---------- 通用編輯對話框 ----------
function openDialog({ title, fields, onSave, onDelete, extras = [] }) {
  const dlg = $('#dlg');
  $('#dlg-title').textContent = title;
  const box = $('#dlg-fields');
  box.replaceChildren(...fields.map((f) => {
    const l = document.createElement('label');
    l.textContent = f.label;
    const i = document.createElement('input');
    Object.assign(i, { type: f.type || 'text', name: f.key, value: f.value ?? '', required: f.required ?? false });
    if (f.step) i.step = f.step;
    if (f.min) i.min = f.min;
    l.append(i);
    return l;
  }));
  $('#dlg-delete').hidden = !onDelete;
  const values = () => {
    const v = {};
    for (const f of fields) {
      const raw = box.querySelector(`[name="${f.key}"]`).value;
      v[f.key] = f.type === 'number' ? Number(raw) : raw.trim();
    }
    return v;
  };
  // 額外動作（例如加 L 型延伸）：先存目前的欄位，再執行
  $('#dlg-extras').replaceChildren(...extras.map((x) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: x.label });
    b.onclick = () => { onSave(values()); dlg.close('extra'); x.onClick(); };
    return b;
  }));
  dlg.onclose = () => {
    if (dlg.returnValue === 'ok') onSave(values());
    else if (dlg.returnValue === 'delete') ask(`確定要刪除「${title.split('：')[1] || ''}」嗎？`).then((ok) => ok && onDelete());
  };
  dlg.returnValue = '';
  dlg.showModal();
}

function removeRoom(id) {
  const n = photosIn(store.state, id).length;
  deleteRoom(id);
  if (n) toast(`房間刪掉了，裡面 ${n} 張照片還在原位置（顯示在「屋外」）`);
}

function editRoom(id) {
  const r = store.state.rooms.find((r) => r.id === id);
  if (!r) return;
  openDialog({
    title: `編輯房間：${r.name}`,
    fields: [
      { key: 'name', label: '名稱', value: r.name, required: true },
      { key: 'color', label: '地板顏色', type: 'color', value: r.color },
      ...r.rects.flatMap((q, i) => {
        const part = r.rects.length > 1 ? (i ? `延伸 ${i} ` : '主體 ') : '';
        return [
          { key: `w${i}`, label: `${part}寬（公尺）`, type: 'number', step: 0.25, min: 0.5, value: q.w },
          { key: `h${i}`, label: `${part}深（公尺）`, type: 'number', step: 0.25, min: 0.5, value: q.h },
        ];
      }),
    ],
    onSave: (v) => {
      const cur = store.state.rooms.find((x) => x.id === id);
      if (!cur) return;
      updateRoom(id, {
        name: v.name, color: v.color,
        rects: cur.rects.map((q, i) => ({ ...q, w: Math.max(0.5, snap(v[`w${i}`] || q.w)), h: Math.max(0.5, snap(v[`h${i}`] || q.h)) })),
      });
    },
    onDelete: () => removeRoom(id),
    extras: [
      { label: '＋ 加一段（做 L 型）', onClick: () => { addSegment(id); toast('加好了，在「編輯格局」裡拖這一段的邊來調整'); if (!editing) toggleEdit(); } },
      ...(r.rects.length > 1 ? [{ label: '－ 移除最後一段', onClick: () => removeSegment(id) }] : []),
    ],
  });
}

// ---------- 加照片 ----------
async function addFilesAt(files, x, y) {
  const added = [];
  for (const [i, f] of files.entries()) {
    toast(`上傳中 ${i + 1} / ${files.length}…`, 60000);
    try {
      const file = await uploadPhoto(f);
      // 多張一起放時排成一列，避免疊在一起
      added.push({ id: uid(), file, x: x + (i % 4) * 0.45, y: y + Math.floor(i / 4) * 0.45, heading: -90, caption: '', t: f.lastModified || Date.now() });
    } catch {
      toast('上傳失敗：請用「python serve.py」開啟這個 App 才能存照片', 5000);
      break;
    }
  }
  if (!added.length) return;
  addPhotos(added);
  selectedPhoto = added.at(-1).id;
  plan.render();
  toast(`已加入 ${added.length} 張照片 · 拖 📷 調整位置，拖藍點轉成拍攝方向`, 4000);
}

const HINT = '把手機照片直接拖到平面圖上 · 點 📷 看照片 · 拖藍點轉方向';
const resetHint = () => { $('#plan-hint').textContent = HINT; };
$('#file-photos').onchange = (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  if (editing) toggleEdit();
  showView('plan');
  $('#plan-hint').textContent = `點平面圖上拍照的位置，放置 ${files.length} 張照片（Esc 取消）`;
  plan.setPlacing((x, y) => { resetHint(); addFilesAt(files, x, y); });
};

// ---------- 照片檢視 ----------
let vList = [];
let vIndex = 0;

function openViewer(ids, index = 0) {
  if (!ids.length) return;
  vList = ids;
  vIndex = Math.max(0, index);
  $('#viewer').hidden = false;
  renderViewer();
}

function renderViewer() {
  const s = store.state;
  vList = vList.filter((id) => s.photos.some((p) => p.id === id));
  if (!vList.length) return closeViewer();
  vIndex = Math.min(vIndex, vList.length - 1);
  const ph = s.photos.find((p) => p.id === vList[vIndex]);
  selectedPhoto = ph.id;
  $('#v-img').src = ph.file;
  $('#v-room').textContent = roomName(s, ph);
  $('#v-date').textContent = `${fmtDate(ph.t)} · ${vIndex + 1} / ${vList.length}`;
  if (document.activeElement !== $('#v-caption')) $('#v-caption').value = ph.caption || '';
  $('#v-prev').disabled = vIndex === 0;
  $('#v-next').disabled = vIndex === vList.length - 1;
  $('#v-strip').replaceChildren(...vList.map((id, i) => {
    const p = s.photos.find((x) => x.id === id);
    const b = document.createElement('button');
    b.className = i === vIndex ? 'current' : '';
    b.innerHTML = `<img src="${esc(p.file)}" loading="lazy" alt="">`;
    b.onclick = () => { vIndex = i; renderViewer(); };
    return b;
  }));
  $('#v-strip .current')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function closeViewer() {
  $('#viewer').hidden = true;
  plan.render();
}

$('#v-close').onclick = closeViewer;
$('#v-prev').onclick = () => { if (vIndex > 0) { vIndex--; renderViewer(); } };
$('#v-next').onclick = () => { if (vIndex < vList.length - 1) { vIndex++; renderViewer(); } };
$('#v-caption').onchange = (e) => updatePhoto(vList[vIndex], { caption: e.target.value.trim() });
$('#v-locate').onclick = () => { closeViewer(); showView('plan'); };
$('#v-delete').onclick = async () => {
  const id = vList[vIndex];
  if (await ask('刪除這張照片？（檔案會移到 photos/.trash，不會真的消失）')) deletePhoto(id);
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { plan.setPlacing(null); resetHint(); }
  if ($('#viewer').hidden || e.target === $('#v-caption')) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowLeft') $('#v-prev').click();
  if (e.key === 'ArrowRight') $('#v-next').click();
});

// 打開某個房間的照片
function openRoomPhotos(roomId) {
  const list = photosIn(store.state, roomId).sort((a, b) => a.t - b.t);
  if (!list.length) {
    const r = store.state.rooms.find((r) => r.id === roomId);
    toast(`${r?.name ?? '這裡'}還沒有照片，把照片拖到平面圖上的這個房間就可以`);
    return;
  }
  openViewer(list.map((p) => p.id));
}

// ---------- 平面圖 ----------
const plan = createPlan($('#plan'), {
  getState: () => store.state,
  isEditing: () => editing,
  canEdit: () => access.canEdit,
  getDisplay: () => ({ ...display, fmt: (m2) => fmtArea(m2) }),
  getSelectedPhoto: () => selectedPhoto,
  onMoveRoom: moveRoom,
  onResizeRect: updateRect,
  onRoomDblClick: (id) => (editing && access.canEdit ? editRoom(id) : openRoomPhotos(id)),
  onPhotoClick: (id) => {
    const s = store.state;
    const ph = s.photos.find((p) => p.id === id);
    const r = roomAt(s, ph.x, ph.y);
    const list = photosIn(s, r?.id ?? null).sort((a, b) => a.t - b.t).map((p) => p.id);
    openViewer(list, list.indexOf(id));
  },
  onMovePhoto: (id, x, y) => { selectedPhoto = id; updatePhoto(id, { x, y }); },
  onRotatePhoto: (id, heading) => { selectedPhoto = id; updatePhoto(id, { heading }); },
  onDropFiles: (files, x, y) => { if (editing) toggleEdit(); addFilesAt(files, x, y); },
});

// ---------- 3D ----------
const house = createHouse($('#view-3d'), { onRoomClick: openRoomPhotos });

// ---------- 照片牆 ----------
function renderGallery(s) {
  const groups = [...s.rooms.map((r) => ({ r, list: photosIn(s, r.id) })), { r: null, list: photosIn(s, null) }]
    .filter((g) => g.list.length);
  if (!groups.length) {
    $('#gallery').innerHTML = `<div class="empty"><b>還沒有照片</b>
      把手機拍的照片直接拖到「平面圖」上，放在拍照的位置；<br>或按右上角「📷 ＋ 照片」選檔案後，點平面圖放置。<br>
      照片會存進專案的 photos 資料夾。</div>`;
    return;
  }
  $('#gallery').innerHTML = groups.map(({ r, list }) => {
    list.sort((a, b) => a.t - b.t);
    return `<section>
      <h3>${r ? `<span class="dot" style="--c:${r.color}"></span>${esc(r.name)}` : '屋外 / 未分類'} <small>${list.length} 張</small></h3>
      <div class="grid">${list.map((p) => `
        <button class="thumb" data-id="${p.id}" data-group="${r?.id ?? ''}">
          <img src="${esc(p.file)}" loading="lazy" alt="${esc(p.caption || '')}">
          ${p.caption ? `<span>${esc(p.caption)}</span>` : ''}
        </button>`).join('')}</div>
    </section>`;
  }).join('');
}
$('#gallery').addEventListener('click', (e) => {
  const b = e.target.closest('.thumb');
  if (!b) return;
  const ids = [...$('#gallery').querySelectorAll(`.thumb[data-group="${b.dataset.group}"]`)].map((x) => x.dataset.id);
  openViewer(ids, ids.indexOf(b.dataset.id));
});

// ---------- 視圖切換 ----------
function showView(v) {
  currentView = v;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.id === `view-${v}`));
  if (v === '3d') { if (houseDirty) { house.rebuild(store.state, display); houseDirty = false; } house.start(); } else house.stop();
  if (v === 'gallery') renderGallery(store.state);
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ---------- 側邊欄 ----------
function renderSidebar(s) {
  $('#room-list').innerHTML = s.rooms.map((r) => {
    const n = photosIn(s, r.id).length;
    return `<li class="room-item" data-id="${r.id}">
      <span class="dot" style="--c:${r.color}"></span>
      <span class="name">${esc(r.name)}<small>${fmtArea(roomArea(r))}</small></span>
      <button data-act="photos" title="看這個房間的照片">📷 ${n}</button>
      <button data-act="edit" title="編輯" class="edit-ui">✎</button>
      <button data-act="delete" title="刪除" class="danger edit-ui">🗑</button>
    </li>`;
  }).join('');
}

$('#room-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  const act = e.target.closest('button')?.dataset.act;
  if (!li || !act) return;
  const id = li.dataset.id;
  if (act === 'photos') openRoomPhotos(id);
  else if (act === 'edit') editRoom(id);
  else if (act === 'delete') {
    const r = store.state.rooms.find((r) => r.id === id);
    if (r) ask(`確定要刪除「${r.name}」嗎？`).then((ok) => ok && removeRoom(id));
  }
});

// ---------- 頂部按鈕 ----------
$('#btn-edit').onclick = () => toggleEdit();
function toggleEdit() {
  editing = !editing;
  document.body.classList.toggle('editing', editing);
  $('#btn-edit').classList.toggle('active', editing);
  $('#btn-edit').textContent = editing ? '✓ 完成編輯' : '✏️ 編輯格局';
  if (editing) { showView('plan'); toast('拖房間中間＝移動 · 拖任一邊或角落＝調整大小 · 雙擊房間＝改名、做 L 型'); }
  plan.render();
}
$('#btn-add-room').onclick = () => { const id = addRoom(); editRoom(id); };
$('#btn-export').onclick = () => {
  const blob = new Blob([JSON.stringify(store.state, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `our-home-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已匯出格局（照片檔案在專案的 photos 資料夾）');
};
$('#file-import').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    if (!Array.isArray(s.rooms)) throw new Error();
    store.replace(s);
    toast('已匯入');
  } catch { toast('這不是有效的備份檔'); }
};

// ---------- 狀態變化時重繪 ----------
store.subscribe((s) => {
  renderSummary(s);
  plan.render();
  renderSidebar(s);
  houseDirty = true;
  if (currentView === '3d') { house.rebuild(s, display); houseDirty = false; }
  if (currentView === 'gallery') renderGallery(s);
  if (!$('#viewer').hidden) renderViewer();
});

document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setDisplay({ unit: b.dataset.unit })));
$('#opt-names').onchange = (e) => setDisplay({ names: e.target.checked });
$('#opt-area').onchange = (e) => setDisplay({ area: e.target.checked });

applyAccess();
renderSummary(store.state);
plan.render();
renderSidebar(store.state);
