import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAllowedOrigin } from './pure.js';

export const sb = createClient(process.env.SUPABASE_URL ?? 'http://localhost', process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'unset', { auth: { persistSession: false } });
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmac = (key: string, s: string) => createHmac('sha256', key).update(s).digest('hex');
export const safeEq = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
export const newToken = () => randomBytes(32).toString('base64url');
export const ip = (req: VercelRequest) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
export const cookie = (req: VercelRequest, name: string) =>
  (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
export const setCookie = (res: VercelResponse, name: string, val: string, maxAge: number) =>
  res.setHeader('Set-Cookie', `${name}=${val}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${maxAge}`);
export const clearCookie = (res: VercelResponse, name: string) =>
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`);

export async function limited(key: string, limit: number, windowSec: number) {
  const { data, error } = await sb.rpc('hit_rate_limit', { p_key: key, p_limit: limit, p_window: windowSec });
  if (error) throw error;
  return data === false;
}
/** Common request prologue: correlation id, no-store, size limit, same-origin check for writes. Returns null if rejected. */
export function begin(req: VercelRequest, res: VercelResponse, maxBytes = 16_384): string | null {
  const rid = randomUUID();
  res.setHeader('X-Request-Id', rid);
  res.setHeader('Cache-Control', 'no-store');
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) { res.status(413).json({ error: 'Yêu cầu quá lớn.' }); return null; }
  if (req.method !== 'GET') {
    const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
    const origin = first(req.headers.origin);
    const host = first(req.headers['x-forwarded-host']) || first(req.headers.host);
    const protocol = first(req.headers['x-forwarded-proto']) || (process.env.VERCEL ? 'https' : 'http');
    if (!isAllowedOrigin(origin, process.env.APP_ORIGIN, host, protocol)) {
      res.status(403).json({ error: 'Nguồn không hợp lệ. Kiểm tra domain đang mở và cấu hình APP_ORIGIN.' });
      return null;
    }
  }
  return rid;
}
export const fail = (res: VercelResponse, rid: string, e: unknown) => {
  console.error(rid, (e as Error)?.message);
  return res.status(500).json({ error: 'Lỗi hệ thống. Vui lòng thử lại.', requestId: rid });
};
