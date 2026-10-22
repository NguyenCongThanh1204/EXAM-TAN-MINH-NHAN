import type { VercelRequest, VercelResponse } from '@vercel/node';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sb, hmac, safeEq, ip, cookie, setCookie, limited, begin, fail } from '../_lib/server.js';
import { escapeCell } from '../_lib/pure.js';
import { parseRows, parseText } from '../_lib/import.js';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph } from 'docx';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const genCode = () => { let s = ''; while (s.length < 10) for (const b of randomBytes(16)) if (b < 248 && s.length < 10) s += ALPHABET[b % 31]; return s; };
// Lịch thi nhập/hiển thị theo giờ Việt Nam (cố định +07:00, khớp timezone của exam_settings).
const VN_OFFSET = '+07:00';
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SettingsIn = z.object({
  title: z.string().trim().min(1, 'Nhập tiêu đề bài thi.').max(200),
  logoUrl: z.string().trim().min(1).max(500),
  openingAt: z.string().regex(LOCAL_DATETIME, 'Ngày giờ bắt đầu không hợp lệ.'),
  closingAt: z.string().regex(LOCAL_DATETIME, 'Ngày giờ kết thúc không hợp lệ.'),
  durationMinutes: z.number().int().min(1).max(600),
  questionCount: z.number().int().min(1).max(1000),
  passingPercentage: z.number().int().min(1).max(100),
  invitationRequired: z.boolean(),
  showScore: z.boolean(),
  active: z.boolean(),
}).refine((v) => Date.parse(`${v.closingAt}:00${VN_OFFSET}`) > Date.parse(`${v.openingAt}:00${VN_OFFSET}`),
  { message: 'Giờ kết thúc phải sau giờ bắt đầu.', path: ['closingAt'] });
type SettingsRow = {
  title: string; logo_url: string; opening_at: string; closing_at: string; duration_minutes: number;
  question_count: number; passing_percentage: number; invitation_required: boolean; show_score: boolean; active: boolean;
};
const toLocal = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 16);
const settingsOut = (s: SettingsRow) => ({
  title: s.title, logoUrl: s.logo_url, openingAt: toLocal(s.opening_at), closingAt: toLocal(s.closing_at),
  durationMinutes: s.duration_minutes, questionCount: s.question_count, passingPercentage: s.passing_percentage,
  invitationRequired: s.invitation_required, showScore: s.show_score, active: s.active,
});

const adminOk = (req: VercelRequest) => {
  const t = cookie(req, 'admin'); if (!t) return false;
  const [exp, sig] = t.split('.');
  return Number(exp) > Date.now() && !!sig && safeEq(sig, hmac(process.env.ADMIN_AUTH_SECRET!, exp));
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rid = begin(req, res, req.query.action === 'import' ? 4_500_000 : 16_384);
  if (!rid) return;
  try {
    const action = String(req.query.action);
    if (action === 'login' && req.method === 'POST') {
      if (await limited('admin:' + ip(req), 5, 60)) return res.status(429).json({ error: 'Quá nhiều lần thử.' });
      const p = z.object({ password: z.string().max(200) }).safeParse(req.body);
      if (!p.success || !process.env.ADMIN_PASSWORD || !safeEq(p.data.password, process.env.ADMIN_PASSWORD))
        return res.status(401).json({ error: 'Sai thông tin đăng nhập.' });
      const exp = String(Date.now() + 4 * 3600_000);
      setCookie(res, 'admin', `${exp}.${hmac(process.env.ADMIN_AUTH_SECRET!, exp)}`, 4 * 3600);
      return res.json({ ok: true });
    }
    if (!adminOk(req)) return res.status(401).json({ error: 'Chưa xác thực.' });

    if (action === 'codes' && req.method === 'GET') {
      const { data, error } = await sb.from('invitation_codes').select('max_uses,uses,created_at')
        .is('revoked_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return res.json({ active: data ? { limit: data.max_uses, uses: data.uses, createdAt: data.created_at } : null });
    }
    if (action === 'codes' && req.method === 'POST') {
      const p = z.object({ limit: z.number().int().min(1).max(100000) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Số lượt dùng không hợp lệ.' });
      const code = genCode();
      const { data, error } = await sb.from('invitation_codes')
        .insert({ code_hash: hmac(process.env.CODE_PEPPER!, code), max_uses: p.data.limit, uses: 0 })
        .select('id').single();
      if (error) throw error;
      // Chỉ giữ một mã hoạt động: thu hồi mã trước đó.
      const { error: revokeErr } = await sb.from('invitation_codes').update({ revoked_at: new Date().toISOString() })
        .is('revoked_at', null).neq('id', data.id);
      if (revokeErr) throw revokeErr;
      return res.json({ code, limit: p.data.limit }); // plaintext shown once, never stored
    }
    if (action === 'settings' && req.method === 'GET') {
      const { data, error } = await sb.from('exam_settings').select('*').eq('id', 1).single();
      if (error) throw error;
      return res.json(settingsOut(data));
    }
    if (action === 'settings' && req.method === 'PUT') {
      const p = SettingsIn.safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: p.error.issues[0]?.message ?? 'Cấu hình không hợp lệ.' });
      const d = p.data;
      const { data, error } = await sb.from('exam_settings').update({
        title: d.title, logo_url: d.logoUrl,
        opening_at: `${d.openingAt}:00${VN_OFFSET}`, closing_at: `${d.closingAt}:00${VN_OFFSET}`,
        duration_minutes: d.durationMinutes, question_count: d.questionCount, passing_percentage: d.passingPercentage,
        invitation_required: d.invitationRequired, show_score: d.showScore, active: d.active,
        updated_at: new Date().toISOString(),
      }).eq('id', 1).select('*').single();
      if (error) throw error;
      return res.json(settingsOut(data));
    }
    if (action === 'reconcile' && req.method === 'POST') {
      const { data, error } = await sb.rpc('reconcile_expired');
      if (error) throw error;
      return res.json({ finalized: data });
    }
    if (action === 'export' && req.method === 'GET') {
      const { error: reconcileError } = await sb.rpc('reconcile_expired');
      if (reconcileError) throw reconcileError;
      if (req.query.clear === 'true') {
        const { data: settings, error: settingsError } = await sb.from('exam_settings')
          .select('active,closing_at').eq('id', 1).single();
        if (settingsError) throw settingsError;
        if (settings.active && Date.parse(settings.closing_at) > Date.now())
          return res.status(409).json({ error: 'Chỉ có thể xóa kết quả khi kỳ thi đã đóng hoặc chưa được kích hoạt.' });
        const { count, error: activeError } = await sb.from('exam_attempts')
          .select('id', { count: 'exact', head: true }).eq('status', 'in_progress');
        if (activeError) throw activeError;
        if ((count ?? 0) > 0)
          return res.status(409).json({ error: 'Vẫn còn bài thi đang làm. Hãy chờ thí sinh nộp bài trước khi xóa kết quả.' });
      }
      const rows: {
        full_name: string; normalized_email: string; position: string;
        correct_count: number | null; incorrect_count: number | null; result: string | null;
      }[] = [];
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb.from('exam_attempts')
          .select('id,full_name,normalized_email,position,correct_count,incorrect_count,result')
          .neq('status', 'in_progress').order('submitted_at').order('id')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < pageSize) break;
      }
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Results');
      ws.columns = ['Họ và tên', 'Email', 'Chức danh', 'Số câu đúng', 'Số câu sai', 'Kết quả'].map((header) => ({ header, width: 24 }));
      for (const r of rows) ws.addRow([escapeCell(r.full_name), escapeCell(r.normalized_email), escapeCell(r.position), r.correct_count, r.incorrect_count, r.result]);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="examination-results-${day}.xlsx"`);
      return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    if (action === 'clear-results' && req.method === 'POST') {
      const p = z.object({ confirm: z.literal(true) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Cần xác nhận trước khi xóa dữ liệu kết quả.' });
      const { data: settings, error: settingsError } = await sb.from('exam_settings')
        .select('active,closing_at').eq('id', 1).single();
      if (settingsError) throw settingsError;
      if (settings.active && Date.parse(settings.closing_at) > Date.now())
        return res.status(409).json({ error: 'Chỉ có thể xóa kết quả khi kỳ thi đã đóng hoặc chưa được kích hoạt.' });
      const { count, error: activeError } = await sb.from('exam_attempts')
        .select('id', { count: 'exact', head: true }).eq('status', 'in_progress');
      if (activeError) throw activeError;
      if ((count ?? 0) > 0)
        return res.status(409).json({ error: 'Vẫn còn bài thi đang làm. Hãy chờ thí sinh nộp bài trước khi xóa kết quả.' });
      const { count: deleted, error } = await sb.from('exam_attempts')
        .delete({ count: 'exact' }).neq('status', 'in_progress');
      if (error) throw error;
      return res.json({ deleted: deleted ?? 0 });
    }
    if (action === 'template' && req.method === 'GET') {
      if (req.query.format === 'docx') {
        const lines = ['HƯỚNG DẪN: mỗi câu gồm dòng câu hỏi (đánh số), các đáp án A-F và dòng "Đáp án: X". Xóa phần ví dụ và nhập câu hỏi thật.', '',
          '1. Thủ đô của Việt Nam là?', 'A. Hà Nội', 'B. Huế', 'C. Đà Nẵng', 'D. Cần Thơ', 'Đáp án: A', '',
          '2. Một năm có bao nhiêu tháng?', 'A. 10', 'B. 12', 'Đáp án: B'];
        const buf = await Packer.toBuffer(new Document({ sections: [{ children: lines.map((t) => new Paragraph(t)) }] }));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-cau-hoi.docx"');
        return res.send(buf);
      }
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Câu hỏi');
      ws.addRow(['Câu hỏi', 'A', 'B', 'C', 'D', 'E', 'F', 'Đáp án đúng']);
      ws.addRow(['Thủ đô của Việt Nam là?', 'Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ', '', '', 'A']);
      ws.addRow(['Một năm có bao nhiêu tháng?', '10', '12', '', '', '', '', 'B']);
      ws.getRow(1).font = { bold: true }; ws.columns.forEach((c, i) => { c.width = i === 0 ? 50 : 18; });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="mau-cau-hoi.xlsx"');
      return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
    }
    if (action === 'import' && req.method === 'POST') {
      const p = z.object({ format: z.enum(['xlsx', 'docx']), mode: z.enum(['replace', 'append']), commit: z.boolean(), file: z.string().min(1).max(4_200_000) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
      const buf = Buffer.from(p.data.file, 'base64');
      if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return res.status(400).json({ error: 'Tệp không đúng định dạng Word/Excel (.docx/.xlsx).' });
      let parsed: ReturnType<typeof parseText>;
      try {
        if (p.data.format === 'xlsx') {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
          const rows: { n: number; cells: string[] }[] = [];
          wb.worksheets[0]?.eachRow({ includeEmpty: false }, (row, n) => {
            rows.push({ n, cells: Array.from({ length: 8 }, (_, i) => String(row.getCell(i + 1).text ?? '').trim()) });
          });
          parsed = parseRows(rows);
        } else {
          parsed = parseText((await mammoth.extractRawText({ buffer: buf })).value);
        }
      } catch { return res.status(400).json({ error: 'Không đọc được tệp. Hãy kiểm tra định dạng theo tệp mẫu.' }); }
      const [{ count }, { data: s }] = await Promise.all([
        sb.from('exam_attempts').select('id', { count: 'exact', head: true }),
        sb.from('exam_settings').select('question_count').eq('id', 1).single(),
      ]);
      const locked = (count ?? 0) > 0;
      const base = { total: parsed.items.length, errors: parsed.errors, needed: s?.question_count ?? 50, locked, preview: parsed.items };
      if (!p.data.commit) return res.json({ ok: parsed.errors.length === 0 && !locked, ...base });
      if (parsed.errors.length) return res.status(422).json({ error: 'Tệp còn lỗi, chưa lưu.', ...base });
      if (locked) return res.status(409).json({ error: 'Đã có thí sinh bắt đầu thi nên không thể đổi câu hỏi.' });
      const runImport = async (mode: 'replace' | 'append') => sb.rpc('import_questions', { p_mode: mode, p_items: parsed.items });
      let { error } = await runImport(p.data.mode);
      if (error?.message.includes('DELETE requires a WHERE clause') && p.data.mode === 'replace') {
        const cleared = await sb.from('exam_questions').delete().not('id', 'is', null);
        if (cleared.error) throw cleared.error;
        ({ error } = await runImport('append'));
      }
      if (error) { if (error.message.includes('locked')) return res.status(409).json({ error: 'Đã có thí sinh bắt đầu thi nên không thể đổi câu hỏi.' }); throw error; }
      return res.json({ ok: true, saved: parsed.items.length });
    }
    return res.status(404).json({ error: 'Không tìm thấy.' });
  } catch (e) { return fail(res, rid, e); }
}
