// 告訴前端：雲端版需要編輯密碼，以及這次帶的密碼對不對
import { canEdit, json } from './_lib.js';

export function GET(request) {
  return json({ needsKey: true, canEdit: canEdit(request) });
}
