// 2D 平面圖（SVG）：編輯格局（拖整間移動、拖任一邊調整大小）、照片圖釘（拖曳移動、轉方向）、拖放照片
import { roomAt, bounds, roomArea, roomCenter, outlinePath, snap } from './store.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.appendChild(e);
  return e;
};
const EDGE = 0.4; // 邊緣拖曳感應寬度（公尺）
const CONE_R = 1.1; // 照片視角扇形半徑（公尺）
const CONE_HALF = 0.5; // 視角半寬（弧度，約 ±29°）
const rad = (d) => (d * Math.PI) / 180;

function conePath(heading) {
  const a = rad(heading);
  const p = (t) => `${(Math.cos(t) * CONE_R).toFixed(3)} ${(Math.sin(t) * CONE_R).toFixed(3)}`;
  return `M0 0L${p(a - CONE_HALF)}A${CONE_R} ${CONE_R} 0 0 1 ${p(a + CONE_HALF)}Z`;
}

export function createPlan(svg, { getState, isEditing, canEdit, getDisplay, getSelectedPhoto, onMoveRoom, onResizeRect, onRoomDblClick, onPhotoClick, onMovePhoto, onRotatePhoto, onDropFiles }) {
  let drag = null;
  let lastTap = {};
  let placing = null;
  let view = { x: 0, y: 0, w: 10, h: 10 };

  const toPlan = (cx, cy) => {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  };

  function render() {
    const s = getState();
    svg.replaceChildren();
    const b = bounds(s.rooms);
    const pad = 2.2;
    view = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);

    const defs = el('defs', {}, svg);
    const pat = el('pattern', { id: 'grid', width: 1, height: 1, patternUnits: 'userSpaceOnUse' }, defs);
    el('path', { d: 'M1 0H0V1', class: 'grid-line' }, pat);
    el('rect', { x: view.x, y: view.y, width: view.w, height: view.h, fill: 'url(#grid)' }, svg);

    const roomsG = el('g', {}, svg);
    const edgesG = el('g', {}, svg); // 編輯把手放最上層，才不會被隔壁房間蓋住
    const show = getDisplay();
    for (const r of s.rooms) {
      const g = el('g', { class: 'room', 'data-id': r.id }, roomsG);
      r.rects.forEach((q, i) => el('rect', { class: 'floor', 'data-idx': i, x: q.x, y: q.y, width: q.w, height: q.h, fill: r.color }, g));
      el('path', { class: 'outline', d: outlinePath(r) }, g);
      const c = roomCenter(r);
      const both = show.names && show.area;
      if (show.names) el('text', { class: 'room-name', x: c.x, y: both ? c.y - 0.1 : c.y + 0.17 }, g).textContent = r.name;
      if (show.area) el('text', { class: 'room-area', x: c.x, y: both ? c.y + 0.45 : c.y + 0.1 }, g).textContent = show.fmt(roomArea(r));

      if (isEditing()) {
        r.rects.forEach((q, i) => {
          const e = EDGE / 2;
          const strips = {
            n: [q.x + e, q.y - e, q.w - EDGE, EDGE], s: [q.x + e, q.y + q.h - e, q.w - EDGE, EDGE],
            w: [q.x - e, q.y + e, EDGE, q.h - EDGE], e: [q.x + q.w - e, q.y + e, EDGE, q.h - EDGE],
            nw: [q.x - e, q.y - e, EDGE, EDGE], ne: [q.x + q.w - e, q.y - e, EDGE, EDGE],
            sw: [q.x - e, q.y + q.h - e, EDGE, EDGE], se: [q.x + q.w - e, q.y + q.h - e, EDGE, EDGE],
          };
          for (const [dir, [x, y, w, h]] of Object.entries(strips)) {
            el('rect', { class: `edge edge-${dir}`, 'data-room': r.id, 'data-idx': i, 'data-dir': dir, x, y, width: Math.max(w, 0.1), height: Math.max(h, 0.1) }, edgesG);
          }
        });
      }
    }

    const photosG = el('g', { class: 'photos' }, svg);
    const sel = getSelectedPhoto();
    for (const ph of s.photos) {
      const g = el('g', { class: 'photo-pin' + (ph.id === sel ? ' selected' : ''), 'data-id': ph.id, transform: `translate(${ph.x} ${ph.y})` }, photosG);
      el('path', { class: 'photo-cone', d: conePath(ph.heading) }, g);
      el('circle', { class: 'photo-dot', r: 0.26 }, g);
      el('text', { class: 'photo-icon' }, g).textContent = '📷';
      const a = rad(ph.heading);
      el('circle', { class: 'photo-rot', r: 0.15, cx: Math.cos(a) * CONE_R, cy: Math.sin(a) * CONE_R }, g).append(
        Object.assign(document.createElementNS(NS, 'title'), { textContent: '拖曳轉方向' }));
    }
    // 選取的照片放最上層
    photosG.querySelector('.selected')?.parentNode.appendChild(photosG.querySelector('.selected'));
  }

  svg.addEventListener('pointerdown', (e) => {
    const s = getState();
    if (placing) {
      const p = toPlan(e.clientX, e.clientY);
      const fn = placing;
      setPlacing(null);
      fn(p.x, p.y);
      return;
    }
    const pin = !isEditing() && e.target.closest('.photo-pin');
    const edge = isEditing() && e.target.closest('.edge');
    const rg = e.target.closest('.room');
    if (pin) {
      const ph = s.photos.find((x) => x.id === pin.dataset.id);
      drag = e.target.closest('.photo-rot')
        ? { kind: 'rotate', g: pin, id: ph.id, ox: ph.x, oy: ph.y, heading: ph.heading }
        : { kind: 'photo', g: pin, id: ph.id, ox: ph.x, oy: ph.y };
      pin.parentNode.appendChild(pin);
    } else if (edge) {
      const r = s.rooms.find((x) => x.id === edge.dataset.room);
      const idx = Number(edge.dataset.idx);
      const g = svg.querySelector(`.room[data-id="${r.id}"]`);
      drag = { kind: 'resize', g, id: r.id, idx, dir: edge.dataset.dir, o: { ...r.rects[idx] }, rectEl: g.querySelector(`.floor[data-idx="${idx}"]`) };
      svg.classList.add('resizing');
    } else if (isEditing() && rg) {
      drag = { kind: 'room', g: rg, id: rg.dataset.id };
    } else return;
    Object.assign(drag, { sx: e.clientX, sy: e.clientY, p0: toPlan(e.clientX, e.clientY), moved: false });
    svg.setPointerCapture(e.pointerId);
    drag.g.classList.add('dragging');
    e.preventDefault();
  });

  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true;
    const p = toPlan(e.clientX, e.clientY);
    const dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (drag.kind === 'photo') {
      drag.nx = drag.ox + dx; drag.ny = drag.oy + dy;
      drag.g.setAttribute('transform', `translate(${drag.nx} ${drag.ny})`);
    } else if (drag.kind === 'rotate') {
      // 吸附到 15° 一格，方便對齊
      drag.heading = Math.round(((Math.atan2(p.y - drag.oy, p.x - drag.ox) * 180) / Math.PI) / 15) * 15;
      drag.g.querySelector('.photo-cone').setAttribute('d', conePath(drag.heading));
      const a = rad(drag.heading), h = drag.g.querySelector('.photo-rot');
      h.setAttribute('cx', Math.cos(a) * CONE_R); h.setAttribute('cy', Math.sin(a) * CONE_R);
    } else if (drag.kind === 'room') {
      drag.dx = snap(dx); drag.dy = snap(dy);
      drag.g.setAttribute('transform', `translate(${drag.dx} ${drag.dy})`);
    } else {
      const o = drag.o, MIN = 0.5;
      let { x, y, w, h } = o;
      if (drag.dir.includes('e')) w = Math.max(MIN, snap(o.w + dx));
      if (drag.dir.includes('s')) h = Math.max(MIN, snap(o.h + dy));
      if (drag.dir.includes('w')) { const nx = Math.min(snap(o.x + dx), o.x + o.w - MIN); w = o.x + o.w - nx; x = nx; }
      if (drag.dir.includes('n')) { const ny = Math.min(snap(o.y + dy), o.y + o.h - MIN); h = o.y + o.h - ny; y = ny; }
      drag.rect = { x, y, w, h };
      Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => drag.rectEl.setAttribute(k, v));
    }
  });

  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.g.classList.remove('dragging');
    svg.classList.remove('resizing');
    if (!d.moved) {
      if (d.kind === 'photo' || d.kind === 'rotate') { onPhotoClick(d.id); return; }
      // 編輯模式下 pointer capture 會讓原生 dblclick 抓不到房間，自己判斷雙擊
      const now = Date.now();
      if (lastTap.id === d.id && now - lastTap.t < 400) { lastTap = {}; onRoomDblClick(d.id); }
      else lastTap = { id: d.id, t: now };
      return;
    }
    if (!canEdit()) { render(); return; } // 唯讀：拖了也不算，放回原位
    if (d.kind === 'photo') onMovePhoto(d.id, d.nx, d.ny);
    else if (d.kind === 'rotate') onRotatePhoto(d.id, d.heading);
    else if (d.kind === 'room') onMoveRoom(d.id, d.dx, d.dy);
    else if (d.rect) onResizeRect(d.id, d.idx, d.rect);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('dblclick', (e) => {
    if (e.target.closest('.photo-pin')) return;
    const rg = e.target.closest('.room');
    const edge = e.target.closest('.edge');
    const id = rg?.dataset.id || edge?.dataset.room;
    if (id) onRoomDblClick(id);
  });

  // 從電腦拖照片進來：放開的位置就是照片的拍攝點
  const host = svg.parentElement;
  host.addEventListener('dragover', (e) => {
    if (!canEdit() || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    host.classList.add('drop-hover');
  });
  host.addEventListener('dragleave', (e) => { if (!host.contains(e.relatedTarget)) host.classList.remove('drop-hover'); });
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!canEdit()) return;
    host.classList.remove('drop-hover');
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const p = toPlan(e.clientX, e.clientY);
    onDropFiles(files, p.x, p.y);
  });

  // 「＋ 照片」選完檔案後，點平面圖放置
  function setPlacing(fn) {
    placing = fn;
    svg.classList.toggle('placing', !!fn);
  }

  return { render, setPlacing };
}
