// 照片：上傳到 Blob（photos/）；刪除時先複製到 trash/ 再刪，誤刪還找得回來
import { put, copy, del } from '@vercel/blob';
import { canEdit, json, forbidden, isOurBlob } from './_lib.js';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export async function POST(request) {
  if (!canEdit(request)) return forbidden();
  const ext = (new URL(request.url).searchParams.get('ext') || 'jpg').toLowerCase();
  if (!TYPES[ext]) return json({ error: 'unsupported type' }, 400);
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: 'empty' }, 400);
  const blob = await put(`photos/photo.${ext}`, body, { access: 'public', contentType: TYPES[ext], addRandomSuffix: true });
  return json({ file: blob.url });
}

export async function DELETE(request) {
  if (!canEdit(request)) return forbidden();
  const file = new URL(request.url).searchParams.get('file');
  if (!file || !isOurBlob(file)) return json({ ok: true }); // 本機路徑或不是我們的檔案：不用處理
  const name = new URL(file).pathname.split('/').pop();
  await copy(file, `trash/${name}`, { access: 'public', addRandomSuffix: true });
  await del(file);
  return json({ ok: true });
}
