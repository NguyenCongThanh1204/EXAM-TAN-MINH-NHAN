import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ZipArchive } from 'archiver';
import type { Archiver } from 'archiver';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { sb, hmac, safeEq, ip, cookie, setCookie, limited, begin, fail } from '../_lib/server.js';
import { escapeCell, isCompanyEmail, normalizeEmail } from '../_lib/pure.js';
import { buildResultsWorkbook, orderExportAttempts } from '../_lib/workbook.js';
import { adminResultPdfName, buildReviewPdf } from '../_lib/review-pdf.js';
import { appendZipEntry } from '../_lib/zip.js';
import { parseRows, parseText } from '../_lib/import.js';
import { buildExamDashboard, buildTabSwitchSummary } from '../_lib/dashboard.js';
import { passingScoreToPercentage, scoreBucketOutOfTen, scoreOutOfTen } from '../_lib/scoring.js';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph } from 'docx';

// Lịch thi nhập/hiển thị theo giờ Việt Nam (cố định +07:00, khớp timezone của exam_settings).
const VN_OFFSET = '+07:00';
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const SettingsIn = z.object({
  title: z.string().trim().min(1, 'Nhập tiêu đề bài thi.').max(200),
  openingAt: z.string().regex(LOCAL_DATETIME, 'Ngày giờ bắt đầu không hợp lệ.'),
  closingAt: z.string().regex(LOCAL_DATETIME, 'Ngày giờ kết thúc không hợp lệ.'),
  durationMinutes: z.number().int().min(1).max(600),
  multipleChoiceCount: z.number().int().min(0).max(1000),
  essayCount: z.number().int().min(0).max(1000),
  passingScore: z.literal(7),
  showScore: z.boolean(),
  displayMode: z.enum(['paged', 'all']),
  active: z.boolean(),
}).refine((v) => v.multipleChoiceCount + v.essayCount === 20,
  { message: 'Bài thi cần đúng 20 câu để mỗi câu có trọng số 0,5 điểm.', path: ['multipleChoiceCount'] })
  .refine((v) => Date.parse(`${v.closingAt}:00${VN_OFFSET}`) > Date.parse(`${v.openingAt}:00${VN_OFFSET}`),
  { message: 'Giờ kết thúc phải sau giờ bắt đầu.', path: ['closingAt'] });
type SettingsRow = {
  title: string; opening_at: string; closing_at: string; duration_minutes: number;
  question_count: number; mc_question_count: number; essay_question_count: number;
  passing_percentage: number; show_score: boolean; active: boolean;
  display_mode?: 'paged' | 'all';
};
const toLocal = (iso: string) => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 16);
const settingsOut = (s: SettingsRow) => ({
  title: s.title, openingAt: toLocal(s.opening_at), closingAt: toLocal(s.closing_at),
  durationMinutes: s.duration_minutes, multipleChoiceCount: s.mc_question_count, essayCount: s.essay_question_count,
  passingScore: s.passing_percentage / 10,
  showScore: s.show_score, displayMode: s.display_mode ?? 'paged', active: s.active,
});
const adminOk = (req: VercelRequest) => {
  const t = cookie(req, 'admin'); if (!t) return false;
  const [exp, sig] = t.split('.');
  return Number(exp) > Date.now() && !!sig && safeEq(sig, hmac(process.env.ADMIN_AUTH_SECRET!, exp));
};
const ParticipantEmails = z.array(z.string().trim().email().max(254)).max(199);
function parseParticipantEmails(values: unknown): string[] | null {
  const parsed = ParticipantEmails.safeParse(values);
  if (!parsed.success) return null;
  const emails = [...new Set(parsed.data.map(normalizeEmail))];
  if (emails.some((email) => !isCompanyEmail(email))) return null;
  return emails;
}
async function replaceParticipantEmails(emails: string[]) {
  const { error } = await sb.rpc('replace_participant_email_allowlist', { p_emails: emails });
  if (error) throw error;
}
async function replaceParticipantEntries(emails: string[], names: (string | null)[]) {
  const { error } = await sb.rpc('replace_participant_email_allowlist_with_names', {
    p_emails: emails,
    p_names: names,
  });
  if (error) throw error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestAction = String(req.query.action);
  const maxBytes = requestAction === 'import' ? 4_500_000
    : requestAction === 'participants-import' ? 360 * 1024
      : requestAction === 'participants' ? 64 * 1024 : 16_384;
  const rid = begin(req, res, maxBytes);
  if (!rid) return;
  try {
    const action = requestAction;
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

    if (action === 'participants' && req.method === 'GET') {
      const { data, error } = await sb.from('participant_email_allowlist').select('email').order('sequence_number');
      if (error) throw error;
      return res.json({ emails: data.map((row) => row.email) });
    }
    if (action === 'participants' && req.method === 'POST') {
      const p = z.object({
        emails: ParticipantEmails,
        mode: z.enum(['append', 'replace']),
      }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Danh sách phải có tối đa 199 email hợp lệ.' });
      const emails = parseParticipantEmails(p.data.emails);
      if (!emails) return res.status(400).json({ error: 'Chỉ chấp nhận tối đa 199 email công ty @tanminhnhan.com.vn hợp lệ.' });
      if (p.data.mode === 'replace') {
        await replaceParticipantEmails(emails);
        return res.json({ emails, count: emails.length });
      }

      const { data: added, error } = await sb.rpc('append_participant_email_allowlist', { p_emails: emails });
      if (error?.message.includes('participant_limit'))
        return res.status(409).json({ error: 'Danh sách tối đa 199 email; email mới vượt quá giới hạn này.' });
      if (error) throw error;
      const { data, error: listError } = await sb.from('participant_email_allowlist')
        .select('email').order('sequence_number');
      if (listError) throw listError;
      return res.json({ emails: data.map((row) => row.email), count: data.length, added });
    }
    if (action === 'participant-template' && req.method === 'GET') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Danh sách email');
      sheet.columns = [
        { header: 'Số thứ tự', key: 'number', width: 16 },
        { header: 'Họ và tên', key: 'name', width: 32 },
        { header: 'Email công ty', key: 'email', width: 42 },
      ];
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      sheet.getCell('A1').note = 'Đánh số thứ tự liên tục từ 1.';
      sheet.getCell('B1').note = 'Nhập họ tên thí sinh, tối đa 120 ký tự.';
      sheet.getCell('C1').note = 'Nhập tối đa 199 email công ty, mỗi dòng một địa chỉ. Ví dụ: ten.nguoidung@tanminhnhan.com.vn.';
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="mau-danh-sach-email.xlsx"');
      return res.status(200).send(buffer);
    }
    if (action === 'participants-import' && req.method === 'POST') {
      const p = z.object({ file: z.string().min(1).max(350_000) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Tệp Excel không hợp lệ hoặc vượt quá dung lượng cho phép.' });
      const buffer = Buffer.from(p.data.file, 'base64');
      if (buffer.length < 4 || buffer.length > 256 * 1024 || buffer[0] !== 0x50 || buffer[1] !== 0x4b)
        return res.status(400).json({ error: 'Chỉ hỗ trợ tệp Excel .xlsx tối đa 256 KB.' });

      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      } catch {
        return res.status(400).json({ error: 'Không đọc được tệp Excel. Hãy tải mẫu và nhập lại.' });
      }
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: 'Tệp Excel không có trang tính danh sách email.' });

      const participantRows: { email: string; name: string | null }[] = [];
      let invalidLayout = false;
      let layout: 'email-only' | 'numbered' | 'named' | null = null;
      let sequence = 0;
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const cells: { column: number; value: string }[] = [];
        row.eachCell({ includeEmpty: false }, (cell, column) => {
          const value = String(cell.text ?? '').trim();
          if (value) cells.push({ column, value });
        });
        if (!cells.length) return;
        const headers = cells.map((cell) => cell.value.toLowerCase());
        if (rowNumber === 1 && cells.length === 1 && cells[0].column === 1
          && ['email', 'email công ty'].includes(headers[0])) {
          layout = 'email-only';
          return;
        }
        if (rowNumber === 1 && cells.length === 2 && cells[0].column === 1 && cells[1].column === 2
          && ['số thứ tự', 'stt'].includes(headers[0])
          && ['email', 'email công ty'].includes(headers[1])) {
          layout = 'numbered';
          return;
        }
        if (rowNumber === 1 && cells.length === 3
          && cells[0].column === 1 && cells[1].column === 2 && cells[2].column === 3
          && ['số thứ tự', 'stt'].includes(headers[0])
          && ['họ và tên', 'họ tên', 'tên thí sinh', 'tên'].includes(headers[1])
          && ['email', 'email công ty'].includes(headers[2])) {
          layout = 'named';
          return;
        }
        if (!layout) {
          if (cells.length === 1 && cells[0].column === 1) layout = 'email-only';
          else if (cells.length === 2 && cells[0].column === 1 && cells[1].column === 2) layout = 'numbered';
          else if (cells.length === 3 && cells[0].column === 1 && cells[1].column === 2 && cells[2].column === 3)
            layout = 'named';
        }
        if (layout === 'named' && cells.length === 3
          && cells[0].column === 1 && cells[1].column === 2 && cells[2].column === 3) {
          sequence += 1;
          if (!Number.isInteger(Number(cells[0].value)) || Number(cells[0].value) !== sequence
            || cells[1].value.length > 120) {
            invalidLayout = true;
            return;
          }
          participantRows.push({ name: cells[1].value, email: cells[2].value });
          return;
        }
        if (layout === 'numbered' && cells.length === 2 && cells[0].column === 1 && cells[1].column === 2) {
          sequence += 1;
          if (!Number.isInteger(Number(cells[0].value)) || Number(cells[0].value) !== sequence) {
            invalidLayout = true;
            return;
          }
          participantRows.push({ name: null, email: cells[1].value });
          return;
        }
        if (layout !== 'email-only' || cells.length !== 1 || cells[0].column !== 1) {
          invalidLayout = true;
          return;
        }
        participantRows.push({ name: null, email: cells[0].value });
      });
      if (invalidLayout) return res.status(400).json({ error: 'Mẫu cần có các cột STT, Họ và tên, Email công ty theo đúng định dạng.' });
      if (participantRows.length === 0) return res.status(400).json({ error: 'Tệp Excel chưa có email nào.' });
      if (participantRows.length > 199) return res.status(400).json({ error: 'Danh sách chỉ được có tối đa 199 email.' });
      const emails = parseParticipantEmails(participantRows.map((row) => row.email));
      if (!emails) return res.status(400).json({ error: 'Email trong tệp phải là địa chỉ công ty @tanminhnhan.com.vn hợp lệ.' });
      const nameByEmail = new Map<string, string | null>();
      for (const row of participantRows) {
        const email = normalizeEmail(row.email);
        if (!nameByEmail.has(email)) nameByEmail.set(email, row.name);
      }
      await replaceParticipantEntries(emails, emails.map((email) => nameByEmail.get(email) ?? null));
      return res.json({ emails, count: emails.length });
    }

    if (action === 'grading' && req.method === 'GET') {
      const attempts: any[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await sb.from('exam_attempts')
          .select('id,full_name,normalized_email,position,main_project,candidate_level,question_order,participant_order,submitted_at,correct_count,incorrect_count,scored_points,total_points,result,submit_reason')
          .neq('status', 'in_progress').order('participant_order').order('submitted_at')
          .range(offset, offset + 999);
        if (error) throw error;
        attempts.push(...data);
        if (data.length < 1000) break;
      }
      const questionIds = [...new Set(attempts.flatMap((attempt) => attempt.question_order as string[]))];
      const questions: any[] = [];
      for (let offset = 0; offset < questionIds.length; offset += 100) {
        const { data, error } = await sb.from('exam_questions')
          .select('id,question_text,question_type')
          .in('id', questionIds.slice(offset, offset + 100));
        if (error) throw error;
        questions.push(...data);
      }
      const questionMap = new Map(questions.map((question) => [question.id, question]));
      const essayQuestionIds = questions.filter((question) => question.question_type === 'essay').map((question) => question.id);
      const answers: any[] = [];
      if (essayQuestionIds.length > 0) {
        for (let attemptOffset = 0; attemptOffset < attempts.length; attemptOffset += 100) {
          const attemptIds = attempts.slice(attemptOffset, attemptOffset + 100).map((attempt) => attempt.id);
          for (let questionOffset = 0; questionOffset < essayQuestionIds.length; questionOffset += 100) {
            const questionChunk = essayQuestionIds.slice(questionOffset, questionOffset + 100);
            for (let offset = 0; ; offset += 1000) {
              const { data, error } = await sb.from('exam_answers')
                .select('attempt_id,question_id,essay_response,essay_passed')
                .in('attempt_id', attemptIds).in('question_id', questionChunk)
                .range(offset, offset + 999);
              if (error) {
                if (error.message.includes('essay_passed')
                  && (/does not exist|schema cache/i.test(error.message))) {
                  console.error(rid, error.message);
                  return res.status(503).json({
                    error: 'Cơ sở dữ liệu đang ở cấu trúc chấm tự luận cũ. Hãy chạy migration 018_binary_essay_grading.sql trên Supabase rồi tải lại.',
                  });
                }
                throw error;
              }
              answers.push(...data);
              if (data.length < 1000) break;
            }
          }
        }
      }
      const answerMap = new Map(answers.map((answer) => [`${answer.attempt_id}:${answer.question_id}`, answer]));
      const gradingAttempts = attempts.map((attempt) => {
        const essayQuestions = (attempt.question_order as string[])
          .map((id, index) => ({ question: questionMap.get(id), index }))
          .filter((entry) => entry.question?.question_type === 'essay');
        const essays = essayQuestions.map(({ question, index }) => {
          const answer = answerMap.get(`${attempt.id}:${question.id}`);
          return {
            questionId: question.id,
            number: index + 1,
            text: question.question_text,
            response: answer?.essay_response ?? '',
            passed: answer?.essay_passed ?? null,
          };
        });
        const mcTotal = (attempt.question_order as string[])
          .filter((id) => questionMap.get(id)?.question_type !== 'essay').length;
        const pendingEssayCount = essays.filter((essay) => essay.passed === null).length;
        return {
          id: attempt.id,
          participantOrder: attempt.participant_order,
          fullName: attempt.full_name,
          email: attempt.normalized_email,
          position: attempt.position,
          mainProject: attempt.main_project,
          candidateLevel: attempt.candidate_level,
          submittedAt: attempt.submitted_at,
          submitReason: attempt.submit_reason,
          correctCount: attempt.correct_count ?? 0,
          incorrectCount: attempt.incorrect_count ?? 0,
          mcPoints: (attempt.correct_count ?? 0) * 0.5,
          mcMaxPoints: mcTotal * 0.5,
          scoredPoints: scoreOutOfTen(attempt.scored_points, attempt.total_points),
          totalPoints: attempt.scored_points === null ? null : 10,
          result: attempt.result,
          essays,
          pendingEssayCount,
        };
      }).filter((attempt) => attempt.essays.length > 0);
      return res.json({ attempts: gradingAttempts });
    }

    if (action === 'grade-essay-attempt' && req.method === 'POST') {
      const p = z.object({
        attemptId: z.string().uuid(),
        grades: z.array(z.object({
          questionId: z.string().uuid(),
          passed: z.boolean(),
        })).max(20),
      }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Kết quả chấm không hợp lệ.' });
      const { data, error } = await sb.rpc('grade_essay_attempt', {
        p_attempt: p.data.attemptId,
        p_grades: p.data.grades,
      });
      if (error?.message.includes('grade_essay_attempt')
        && (/does not exist|schema cache/i.test(error.message))) {
        console.error(rid, error.message);
        return res.status(503).json({
          error: 'Cơ sở dữ liệu chưa hỗ trợ lưu chấm cả bài. Hãy chạy migration 019_bulk_essay_grading_and_tab_violation.sql trên Supabase.',
        });
      }
      if (error?.message.includes('invalid_grade'))
        return res.status(400).json({ error: 'Kết quả chấm không hợp lệ.' });
      if (error?.message.includes('attempt_not_found'))
        return res.status(404).json({ error: 'Không tìm thấy bài thi.' });
      if (error?.message.includes('attempt_not_submitted'))
        return res.status(409).json({ error: 'Chỉ chấm được bài thi đã nộp.' });
      if (error?.message.includes('question_not_in_attempt') || error?.message.includes('question_not_essay'))
        return res.status(400).json({ error: 'Câu hỏi tự luận không thuộc bài thi này.' });
      if (error) throw error;
      return res.json({ grading: data });
    }

    if (action === 'projects' && req.method === 'GET') {
      const { data, error } = await sb.from('exam_projects').select('id,name,active').order('name');
      if (error) throw error;
      return res.json({ projects: data });
    }
    if (action === 'dashboard' && req.method === 'GET') {
      if (await limited('dashboard:' + ip(req), 60, 60)) return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
      const { data: projectRows, error: projectError } = await sb.from('exam_projects')
        .select('id,name,active').order('name');
      if (projectError) throw projectError;
      const pageSize = 1000;
      const attempts: {
        project_id: string | null;
        main_project: string | null;
        candidate_level: string | null;
        correct_count: number | null;
        incorrect_count: number | null;
        scored_points: number | null;
        total_points: number | null;
        result: string | null;
        submit_reason: string | null;
      }[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb.from('exam_attempts')
          .select('project_id,main_project,candidate_level,correct_count,incorrect_count,scored_points,total_points,result,submit_reason')
          .neq('status', 'in_progress').order('id').range(offset, offset + pageSize - 1);
        if (error) throw error;
        attempts.push(...data);
        if (data.length < pageSize) break;
      }

      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
      const level = typeof req.query.level === 'string' ? req.query.level : '';
      const scoreBucket = typeof req.query.scoreBucket === 'string' ? req.query.scoreBucket : '';
      if (projectId && !z.string().uuid().safeParse(projectId).success)
        return res.status(400).json({ error: 'Bộ lọc công trình không hợp lệ.' });
      if (level.length > 100) return res.status(400).json({ error: 'Bộ lọc cấp bậc không hợp lệ.' });
      if (scoreBucket && (!/^[0-4]$/.test(scoreBucket)))
        return res.status(400).json({ error: 'Bộ lọc điểm không hợp lệ.' });

      const levelOptions = [...new Set(attempts.map((attempt) => attempt.candidate_level?.trim() || 'Chưa khai báo'))]
        .sort((a, b) => a.localeCompare(b, 'vi'));
      const contextFiltered = attempts.filter((attempt) => {
        if (projectId && attempt.project_id !== projectId) return false;
        if (level && (attempt.candidate_level?.trim() || 'Chưa khai báo') !== level) return false;
        if (scoreBucket) {
          if (scoreBucketOutOfTen(attempt.scored_points, attempt.total_points) !== Number(scoreBucket)) return false;
        }
        return true;
      });
      return res.json({
        dashboard: buildExamDashboard(contextFiltered, projectRows),
        tabSwitchSummary: buildTabSwitchSummary(attempts),
        levelOptions,
      });
    }
    if (action === 'projects' && req.method === 'POST') {
      const p = z.object({ name: z.string().trim().min(1).max(200) }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Tên công trình không hợp lệ.' });
      const { data, error } = await sb.from('exam_projects').insert({ name: p.data.name })
        .select('id,name,active').single();
      if (error?.code === '23505') return res.status(409).json({ error: 'Tên công trình này đã có trong danh sách.' });
      if (error) throw error;
      return res.status(201).json(data);
    }
    if (action === 'projects' && req.method === 'DELETE') {
      const p = z.object({ id: z.string().uuid() }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Công trình cần xóa không hợp lệ.' });
      const { count, error: countError } = await sb.from('exam_attempts')
        .select('id', { count: 'exact', head: true }).eq('project_id', p.data.id);
      if (countError) throw countError;
      if ((count ?? 0) > 0)
        return res.status(409).json({ error: 'Công trình đã có bài thi lịch sử nên không thể xóa. Hãy ẩn công trình để giữ dữ liệu cũ.' });
      const { data, error } = await sb.from('exam_projects').delete()
        .eq('id', p.data.id).select('id').maybeSingle();
      if (error?.code === '23503')
        return res.status(409).json({ error: 'Công trình vừa được dùng trong bài thi nên không thể xóa. Hãy ẩn công trình để giữ dữ liệu cũ.' });
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Không tìm thấy công trình.' });
      return res.json({ id: data.id });
    }
    if (action === 'projects' && req.method === 'PUT') {
      const p = z.object({ id: z.string().uuid(), active: z.boolean() }).safeParse(req.body);
      if (!p.success) return res.status(400).json({ error: 'Cập nhật công trình không hợp lệ.' });
      if (!p.data.active) {
        const { count, error: countError } = await sb.from('exam_projects')
          .select('id', { count: 'exact', head: true }).eq('active', true);
        if (countError) throw countError;
        if ((count ?? 0) <= 1) return res.status(409).json({ error: 'Cần giữ ít nhất một công trình đang được chọn.' });
      }
      const { data, error } = await sb.from('exam_projects').update({ active: p.data.active })
        .eq('id', p.data.id).select('id,name,active').maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Không tìm thấy công trình.' });
      return res.json(data);
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
        title: d.title,
        opening_at: `${d.openingAt}:00${VN_OFFSET}`, closing_at: `${d.closingAt}:00${VN_OFFSET}`,
        duration_minutes: d.durationMinutes, question_count: d.multipleChoiceCount + d.essayCount,
        mc_question_count: d.multipleChoiceCount, essay_question_count: d.essayCount,
        passing_percentage: passingScoreToPercentage(d.passingScore),
        show_score: d.showScore, display_mode: d.displayMode, active: d.active,
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
      const { data: examSettings, error: examSettingsError } = await sb.from('exam_settings')
        .select('active,closing_at').eq('id', 1).single();
      if (examSettingsError) throw examSettingsError;
      if (req.query.clear === 'true') {
        if (examSettings.active && Date.parse(examSettings.closing_at) > Date.now())
          return res.status(409).json({ error: 'Chỉ có thể xóa kết quả khi kỳ thi đã đóng hoặc chưa được kích hoạt.' });
        const { count, error: activeError } = await sb.from('exam_attempts')
          .select('id', { count: 'exact', head: true }).eq('status', 'in_progress');
        if (activeError) throw activeError;
        if ((count ?? 0) > 0)
          return res.status(409).json({ error: 'Vẫn còn bài thi đang làm. Hãy chờ thí sinh nộp bài trước khi xóa kết quả.' });
        const { count: pendingGrades, error: pendingGradeError } = await sb.from('exam_attempts')
          .select('id', { count: 'exact', head: true }).neq('status', 'in_progress').is('result', null);
        if (pendingGradeError) throw pendingGradeError;
        if ((pendingGrades ?? 0) > 0)
          return res.status(409).json({ error: 'Vẫn còn bài tự luận chưa chấm xong. Hãy chấm đủ trước khi tải và xóa kết quả.' });
      }
      const pageSize = 1000;
      const idChunk = 100; // keeps PostgREST URLs short
      const attempts: any[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb.from('exam_attempts')
          .select('id,full_name,normalized_email,position,candidate_level,main_project,question_order,correct_count,incorrect_count,scored_points,total_points,result,started_at,submitted_at,submit_reason,participant_order,participant_list_name')
          .neq('status', 'in_progress').order('submitted_at').order('id')
          .range(offset, offset + pageSize - 1);
        if (error) throw error;
        attempts.push(...data);
        if (data.length < pageSize) break;
      }
      let exportAttempts = attempts as any[];
      if (exportAttempts.some((attempt) => attempt.participant_order == null)) {
        const { data: participants, error } = await sb.from('participant_email_allowlist')
          .select('email,sequence_number');
        if (error) throw error;
        const orderByEmail = new Map(participants.map((participant) => [
          normalizeEmail(participant.email), participant.sequence_number,
        ]));
        exportAttempts = exportAttempts.map((attempt) => ({
          ...attempt,
          participant_order: attempt.participant_order ?? orderByEmail.get(normalizeEmail(attempt.normalized_email)) ?? null,
        }));
      }
      if (exportAttempts.some((attempt) => attempt.participant_order == null))
        return res.status(409).json({ error: 'Không xác định được STT theo danh sách email cho một số bài thi. Hãy kiểm tra danh sách email đã nhập.' });
      const orderedAttempts = orderExportAttempts(exportAttempts);
      const questionIds = [...new Set(orderedAttempts.flatMap((a) => a.question_order as string[]))];
      const questions: any[] = [];
      for (let offset = 0; offset < questionIds.length; offset += idChunk) {
        const { data, error } = await sb.from('exam_questions')
          .select('id,question_text,options,question_type,points,question_keys(correct_options,reference_answer)')
          .in('id', questionIds.slice(offset, offset + idChunk));
        if (error) throw error;
        questions.push(...data);
      }
      const answers: any[] = [];
      for (let attemptOffset = 0; attemptOffset < orderedAttempts.length; attemptOffset += idChunk) {
        const attemptIds = orderedAttempts.slice(attemptOffset, attemptOffset + idChunk).map((a) => a.id);
        for (let offset = 0; ; offset += pageSize) {
          const { data, error } = await sb.from('exam_answers')
            .select('attempt_id,question_id,selected_options,essay_response,essay_passed')
            .in('attempt_id', attemptIds).range(offset, offset + pageSize - 1);
          if (error) throw error;
          answers.push(...data);
          if (data.length < pageSize) break;
        }
      }
      const wb = buildResultsWorkbook({ attempts: orderedAttempts, questions, answers });
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
      const archive: Archiver = new ZipArchive({ zlib: { level: 6 } });
      const archiveError = (error: Error) => {
        console.error(rid, error.message);
        if (!res.destroyed) res.destroy(error);
      };
      archive.on('error', archiveError);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="examination-review-${day}.zip"`);
      archive.pipe(res);
      const workbookName = `examination-results-${day}.xlsx`;
      await appendZipEntry(archive, Buffer.from(await wb.xlsx.writeBuffer()), workbookName);
      const answersByAttempt = new Map<string, any[]>();
      for (const answer of answers) {
        const items = answersByAttempt.get(answer.attempt_id) ?? [];
        items.push(answer);
        answersByAttempt.set(answer.attempt_id, items);
      }
      for (let index = 0; index < orderedAttempts.length; index++) {
        const attempt = orderedAttempts[index];
        const name = `pdfs/${adminResultPdfName(attempt, attempt.participant_order ?? index + 1)}`;
        const pdf = await buildReviewPdf({ attempt, questions, answers: answersByAttempt.get(attempt.id) ?? [] });
        await appendZipEntry(archive, pdf, name);
      }
      const finished = new Promise<void>((resolve, reject) => {
        res.once('finish', resolve);
        res.once('error', reject);
        archive.once('error', reject);
      });
      await Promise.all([archive.finalize(), finished]);
      return;
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
      const { count: pendingGrades, error: pendingGradeError } = await sb.from('exam_attempts')
        .select('id', { count: 'exact', head: true }).neq('status', 'in_progress').is('result', null);
      if (pendingGradeError) throw pendingGradeError;
      if ((pendingGrades ?? 0) > 0)
        return res.status(409).json({ error: 'Vẫn còn bài tự luận chưa chấm xong. Hãy chấm đủ trước khi xóa kết quả.' });
      const { count: deleted, error } = await sb.from('exam_attempts')
        .delete({ count: 'exact' }).neq('status', 'in_progress');
      if (error) throw error;
      return res.json({ deleted: deleted ?? 0 });
    }
    if (action === 'template' && req.method === 'GET') {
      if (req.query.format === 'docx') {
        const lines = [
          'HƯỚNG DẪN: mỗi câu bắt đầu bằng số thứ tự. Có thể ghi Loại: single, multiple hoặc essay (mặc định single). Bài thi gồm 20 câu, mỗi câu tối đa 0,5 điểm; đạt từ 7/10. Câu tự luận được chấm Đạt (0,5 điểm) hoặc Không đạt (0 điểm).',
          'Câu trắc nghiệm ghi A-F và Đáp án: A hoặc A,C. Câu tự luận ghi Đáp án tham khảo: nội dung đáp án.',
          'Xóa ví dụ trước khi nhập câu hỏi thật.', '',
          '1. Thủ đô của Việt Nam là?', 'Loại: single',
          'A. Hà Nội', 'B. Huế', 'C. Đà Nẵng', 'D. Cần Thơ', 'Đáp án: A', '',
          '2. Chọn các số nguyên tố', 'Loại: multiple',
          'A. 2', 'B. 4', 'C. 5', 'Đáp án: A,C', '',
          '3. Trình bày một giải pháp bảo vệ môi trường', 'Loại: essay',
          'Đáp án tham khảo: Nêu được các biện pháp giảm rác thải, tiết kiệm tài nguyên và bảo vệ hệ sinh thái.',
        ];
        const buf = await Packer.toBuffer(new Document({ sections: [{ children: lines.map((t) => new Paragraph(t)) }] }));
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="mau-cau-hoi.docx"');
        return res.send(buf);
      }
      const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Câu hỏi');
      ws.addRow(['Câu hỏi', 'A', 'B', 'C', 'D', 'E', 'F', 'Đáp án đúng (A,C)', 'Loại', 'Điểm (không dùng; 0,5/câu)', 'Đáp án tham khảo']);
      ws.addRow(['Thủ đô của Việt Nam là?', 'Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ', '', '', 'A', 'single', '', '']);
      ws.addRow(['Chọn các số nguyên tố', '2', '4', '5', '', '', '', 'A,C', 'multiple', '', '']);
      ws.addRow(['Trình bày một giải pháp bảo vệ môi trường', '', '', '', '', '', '', '', 'essay', '', 'Nêu biện pháp giảm rác thải, tiết kiệm tài nguyên và bảo vệ hệ sinh thái.']);
      ws.getRow(1).font = { bold: true };
      ws.getCell(1, 10).note = 'Để trống cột này. Tất cả câu hỏi đều tối đa 0,5 điểm; tự luận chấm Đạt = 0,5 điểm hoặc Không đạt = 0 điểm.';
      ws.columns.forEach((c, i) => { c.width = i === 0 ? 50 : i === 10 ? 60 : 18; });
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
            rows.push({ n, cells: Array.from({ length: 11 }, (_, i) => String(row.getCell(i + 1).text ?? '').trim()) });
          });
          parsed = parseRows(rows);
        } else {
          parsed = parseText((await mammoth.extractRawText({ buffer: buf })).value);
        }
      } catch { return res.status(400).json({ error: 'Không đọc được tệp. Hãy kiểm tra định dạng theo tệp mẫu.' }); }
      const [
        { count: attemptCount, error: attemptError },
        { data: s, error: settingsError },
        { count: activeMultipleCount, error: multipleError },
        { count: activeEssayCount, error: essayError },
      ] = await Promise.all([
        sb.from('exam_attempts').select('id', { count: 'exact', head: true }),
        sb.from('exam_settings').select('mc_question_count,essay_question_count').eq('id', 1).single(),
        sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('active', true).neq('question_type', 'essay'),
        sb.from('exam_questions').select('id', { count: 'exact', head: true }).eq('active', true).eq('question_type', 'essay'),
      ]);
      if (attemptError) throw attemptError;
      if (settingsError) throw settingsError;
      if (multipleError) throw multipleError;
      if (essayError) throw essayError;
      const locked = (attemptCount ?? 0) > 0;
      const neededMultiple = s.mc_question_count;
      const neededEssay = s.essay_question_count;
      const currentMultiple = p.data.mode === 'replace' ? 0 : activeMultipleCount ?? 0;
      const currentEssay = p.data.mode === 'replace' ? 0 : activeEssayCount ?? 0;
      const availableMultiple = currentMultiple + parsed.items.filter((item) => item.type !== 'essay').length;
      const availableEssay = currentEssay + parsed.items.filter((item) => item.type === 'essay').length;
      const pickedMultiple = Math.min(availableMultiple, neededMultiple);
      const pickedEssay = Math.min(availableEssay, neededEssay);
      const base = {
        total: parsed.items.length, availableMultiple, availableEssay, neededMultiple, neededEssay,
        pickedMultiple, pickedEssay, errors: parsed.errors, locked, preview: parsed.items,
      };
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
  } catch (e) {
    if (res.headersSent) {
      console.error(rid, (e as Error)?.message);
      if (!res.destroyed) res.destroy(e as Error);
      return;
    }
    return fail(res, rid, e);
  }
}
