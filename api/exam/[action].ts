import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { sb, sha256, hmac, newToken, ip, cookie, setCookie, clearCookie, limited, begin, fail } from '../_lib/server';
import { normalizeEmail } from '../_lib/pure';

const Start = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  position: z.string().trim().min(2).max(120),
  code: z.string().trim().max(32).optional(),
});
const Answer = z.object({ questionId: z.string().uuid(), optionId: z.string().min(1).max(32) });
const Submit = z.object({ reason: z.enum(['manual', 'tab_switch', 'deadline']) });
const ERR: Record<string, [number, string]> = {
  not_open: [403, 'Kỳ thi chưa mở.'], closed: [403, 'Kỳ thi đã đóng.'],
  bad_code: [403, 'Mã mời không hợp lệ, đã hết lượt sử dụng hoặc đã bị thu hồi.'], not_ready: [503, 'Kỳ thi chưa sẵn sàng.'],
};

async function attemptId(req: VercelRequest): Promise<string | null> {
  const t = cookie(req, 'attempt');
  if (!t || t.length !== 43) return null;
  const { data } = await sb.from('exam_attempts').select('id').eq('token_hash', sha256(t)).maybeSingle();
  return data?.id ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rid = begin(req, res);
  if (!rid) return;
  try {
    const action = String(req.query.action);
    const A = ip(req);

    if (action === 'info' && req.method === 'GET') {
      const { data: s, error } = await sb.from('exam_settings').select('*').eq('id', 1).single();
      if (error) throw error;
      return res.json({ title: s.title, logoUrl: s.logo_url, openingAt: s.opening_at, closingAt: s.closing_at,
        durationMinutes: s.duration_minutes, questionCount: s.question_count, invitationRequired: s.invitation_required,
        active: s.active, serverNow: new Date().toISOString() });
    }

    if (action === 'start' && req.method === 'POST') {
      // Per-IP limit is generous: many candidates may share one office NAT address.
      if (await limited('start:' + A, 200, 60)) return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
      const p = Start.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.', fields: p.error.flatten().fieldErrors });
      const { data: s } = await sb.from('exam_settings').select('invitation_required').eq('id', 1).single();
      const code = p.data.code?.toUpperCase().replace(/[\s-]/g, '');
      if (s?.invitation_required) {
        if (!code) return res.status(400).json({ error: 'Vui lòng nhập mã mời.' });
        if (await limited('code:' + A, 60, 600)) return res.status(429).json({ error: 'Quá nhiều lần thử mã.' });
      }
      const token = newToken();
      const { error } = await sb.rpc('start_attempt', {
        p_name: p.data.fullName, p_email: normalizeEmail(p.data.email), p_position: p.data.position,
        p_token_hash: sha256(token), p_code_hash: code ? hmac(process.env.CODE_PEPPER!, code) : '',
      });
      if (error) {
        const k = Object.keys(ERR).find((x) => error.message.includes(x));
        if (k) return res.status(ERR[k][0]).json({ error: ERR[k][1] });
        throw error;
      }
      setCookie(res, 'attempt', token, 7200);
      return res.status(201).json({ ok: true });
    }

    const id = await attemptId(req);
    if (!id) return res.status(401).json({ error: 'Phiên thi không hợp lệ.' });

    if (action === 'state' && req.method === 'GET') {
      const { data, error } = await sb.rpc('attempt_state', { p_attempt: id });
      if (error) throw error;
      return res.json(data);
    }

    if (action === 'answer' && req.method === 'PUT') {
      if (await limited('ans:' + id, 120, 60)) return res.status(429).json({ error: 'Quá nhiều yêu cầu.' });
      const p = Answer.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
      const { data, error } = await sb.rpc('save_answer', { p_attempt: id, p_question: p.data.questionId, p_option: p.data.optionId });
      if (error) throw error;
      if (data === 'ok') return res.json({ ok: true });
      if (data === 'invalid') return res.status(400).json({ error: 'Câu hỏi hoặc đáp án không hợp lệ.' });
      return res.status(409).json({ error: 'expired' });
    }

    if (action === 'submit' && req.method === 'POST') {
      if (await limited('sub:' + id, 20, 60)) return res.status(429).json({ error: 'Quá nhiều yêu cầu.' });
      const p = Submit.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
      const f = await sb.rpc('finalize_attempt', { p_attempt: id, p_reason: p.data.reason }); // idempotent
      if (f.error) throw f.error;
      const { data, error } = await sb.rpc('attempt_state', { p_attempt: id });
      if (error) throw error;
      return res.json(data);
    }

    if (action === 'reset' && req.method === 'POST') {
      const { data, error } = await sb.from('exam_attempts').select('status').eq('id', id).single();
      if (error) throw error;
      if (data.status === 'in_progress') return res.status(409).json({ error: 'Bạn cần nộp bài trước khi quay lại trang chủ.' });
      clearCookie(res, 'attempt');
      return res.json({ ok: true });
    }
    return res.status(404).json({ error: 'Không tìm thấy.' });
  } catch (e) { return fail(res, rid, e); }
}
