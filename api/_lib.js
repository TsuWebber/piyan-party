// API 共用：編輯密碼檢查、JSON 回應
import { timingSafeEqual } from 'node:crypto';

// 有正確的 x-edit-key 才能修改；沒設定 EDIT_KEY 時一律唯讀
export function canEdit(request) {
  const key = process.env.EDIT_KEY;
  const given = request.headers.get('x-edit-key') || '';
  if (!key || !given) return false;
  const a = Buffer.from(key), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const forbidden = () => json({ error: '需要編輯密碼' }, 401);

// 只接受這個 Blob store 的網址，避免被拿去刪別的東西
export function isOurBlob(url) {
  try { return new URL(url).hostname.endsWith('.blob.vercel-storage.com'); } catch { return false; }
}
