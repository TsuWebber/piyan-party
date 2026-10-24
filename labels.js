import * as THREE from 'three';

const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';

function toSprite(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.renderOrder = 10;
  spr.userData.aspect = canvas.width / canvas.height;
  return spr;
}

// 圓角文字標籤
export function makeLabel(text, { bg = '#ffffff', fg = '#1f2937', size = 44 } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `600 ${size}px ${FONT}`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width + size * 1.1);
  c.height = Math.ceil(size * 1.7);
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(2, 2, c.width - 4, c.height - 4, c.height / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + size * 0.05);
  return toSprite(c);
}
