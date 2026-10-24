// 格局資料：每次儲存都寫一個新的版本到 Blob（data/），讀取時拿最新的；保留最近 30 版當歷史備份
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { list, put, del } from '@vercel/blob';
import { canEdit, json, forbidden } from './_lib.js';

const KEEP = 30;

async function versions() {
  const { blobs } = await list({ prefix: 'data/' });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

export async function GET() {
  const [latest] = await versions();
  if (latest) {
    const r = await fetch(latest.url);
    if (r.ok) return json(await r.json());
  }
  // 雲端還沒有存過：用 repo 裡的 home-data.json 當起點
  const seed = await readFile(join(process.cwd(), 'home-data.json'), 'utf-8');
  return json(JSON.parse(seed));
}

export async function PUT(request) {
  if (!canEdit(request)) return forbidden();
  let data;
  try {
    data = await request.json();
    if (!Array.isArray(data.rooms)) throw new Error();
  } catch {
    return json({ error: 'invalid data' }, 400);
  }
  await put(`data/home-${Date.now()}.json`, JSON.stringify(data), {
    access: 'public', contentType: 'application/json', addRandomSuffix: true,
  });
  const old = (await versions()).slice(KEEP);
  if (old.length) await del(old.map((b) => b.url));
  return json({ ok: true });
}
