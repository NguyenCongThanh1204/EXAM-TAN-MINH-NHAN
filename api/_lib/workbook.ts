import ExcelJS from 'exceljs';
import { escapeCell } from './pure.js';
import { reviewPdfName } from './review-pdf.js';

type Option = { id: string; text: string };
type Key = { correct_options: string[] | null; reference_answer: string | null };
export type ExportAttempt = {
  id: string; full_name: string; normalized_email: string; position: string;
  candidate_level: string; main_project: string; question_order: string[];
  correct_count: number | null; incorrect_count: number | null;
  scored_points: number | null; total_points: number | null; result: string | null;
  started_at: string; submitted_at: string | null; submit_reason?: string | null;
};
export type ExportQuestion = {
  id: string; question_text: string; options: Option[] | null;
  question_type: 'single' | 'multiple' | 'essay'; points: number;
  question_keys?: Key | Key[] | null;
};
export type ExportAnswer = {
  attempt_id: string; question_id: string; selected_options: string[] | null; essay_response: string | null;
};

const COLOR = {
  mc: 'FF0F766E', essay: 'FFB45309', detail: 'FF1D4ED8', key: 'FF475569',
  okFill: 'FFD1FAE5', okFont: 'FF065F46', badFill: 'FFFEE2E2', badFont: 'FF991B1B',
  warnFill: 'FFFEF3C7', inputFill: 'FFFEF08A', border: 'FFCBD5E1',
};
const TYPE_LABEL = { single: 'Một đáp án', multiple: 'Nhiều đáp án', essay: 'Tự luận' } as const;
const DATE_FORMAT = 'dd/mm/yyyy hh:mm:ss';
const DURATION_FORMAT = '[h]:mm:ss';
const VN_OFFSET_MS = 7 * 3600_000;

const keyOf = (q: ExportQuestion): Key => (Array.isArray(q.question_keys) ? q.question_keys[0] : q.question_keys) ?? { correct_options: [], reference_answer: '' };
const vnDate = (iso: string | null) => (iso ? new Date(Date.parse(iso) + VN_OFFSET_MS) : null);
const durationDays = (start: string, end: string | null) => (end ? Math.max(0, Date.parse(end) - Date.parse(start)) / 86_400_000 : null);
const label = (options: Option[], id: string) => {
  const o = options.find((x) => x.id === id);
  return o ? `${id.toUpperCase()}. ${o.text}` : id.toUpperCase();
};

function addSheet(wb: ExcelJS.Workbook, name: string, color: string, columns: { header: string; width: number }[]) {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: color } } });
  ws.columns = columns;
  const header = ws.getRow(1);
  header.height = 34;
  header.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];
  return ws;
}

function finish(ws: ExcelJS.Worksheet) {
  ws.autoFilter = { from: 'A1', to: `${ws.getColumn(ws.columnCount).letter}1` };
  ws.eachRow((row, n) => row.eachCell({ includeEmpty: true }, (c) => {
    c.border = {
      top: { style: 'thin', color: { argb: COLOR.border } }, bottom: { style: 'thin', color: { argb: COLOR.border } },
      left: { style: 'thin', color: { argb: COLOR.border } }, right: { style: 'thin', color: { argb: COLOR.border } },
    };
    if (n > 1) c.alignment = { ...c.alignment, vertical: 'top', wrapText: true };
  }));
}

function tone(cell: ExcelJS.Cell, kind: 'ok' | 'bad' | 'warn') {
  const fill = kind === 'ok' ? COLOR.okFill : kind === 'bad' ? COLOR.badFill : COLOR.warnFill;
  const font = kind === 'ok' ? COLOR.okFont : kind === 'bad' ? COLOR.badFont : 'FF92400E';
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.font = { bold: true, color: { argb: font } };
  cell.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
}

export function buildResultsWorkbook(input: {
  attempts: ExportAttempt[]; questions: ExportQuestion[]; answers: ExportAnswer[];
}): ExcelJS.Workbook {
  const questionMap = new Map(input.questions.map((q) => [q.id, q]));
  const answerMap = new Map(input.answers.map((a) => [`${a.attempt_id}:${a.question_id}`, a]));
  const wb = new ExcelJS.Workbook();

  const person = [
    { header: 'Mã bài thi', width: 38 }, { header: 'Họ và tên', width: 26 }, { header: 'Email', width: 30 },
  ];
  const candidate = [
    { header: 'Chức danh', width: 22 }, { header: 'Cấp bậc', width: 20 }, { header: 'Công trình chính', width: 28 },
    { header: 'Bắt đầu làm bài', width: 21 }, { header: 'Kết thúc (nộp bài)', width: 21 }, { header: 'Thời gian làm bài (giờ:phút:giây)', width: 20 },
  ];

  const mc = addSheet(wb, 'Kết quả trắc nghiệm', COLOR.mc, [
    { header: 'STT', width: 7 }, ...person, ...candidate,
    { header: 'Số câu trắc nghiệm', width: 14 }, { header: 'Số câu đúng', width: 12 }, { header: 'Số câu sai / bỏ trống', width: 14 },
    { header: 'Điểm trắc nghiệm (1 điểm/câu)', width: 16 }, { header: 'Điểm tối đa', width: 11 }, { header: 'Tỷ lệ đúng', width: 11 },
    { header: 'Kết quả trắc nghiệm', width: 17 }, { header: 'Điểm tự luận (giám khảo chấm)', width: 18 }, { header: 'Điểm tự luận tối đa', width: 13 },
  ]);
  const essay = addSheet(wb, 'Kết quả tự luận', COLOR.essay, [
    { header: 'STT', width: 7 }, ...person, ...candidate,
    { header: 'Câu số', width: 8 }, { header: 'Câu hỏi tự luận', width: 50 }, { header: 'Bài làm của thí sinh', width: 60 },
    { header: 'Đáp án tham khảo', width: 55 }, { header: 'Điểm tối đa', width: 11 },
    { header: 'Điểm giám khảo chấm (nhập vào đây)', width: 20 }, { header: 'Nhận xét', width: 35 },
  ]);
  const review = addSheet(wb, 'Hồ sơ phúc khảo', COLOR.detail, [
    { header: 'STT', width: 7 }, ...person, ...candidate,
    { header: 'Điểm trắc nghiệm', width: 14 }, { header: 'Kết quả', width: 18 },
    { header: 'Tệp PDF phúc khảo (trong ZIP)', width: 42 },
  ]);
  const keySheet = addSheet(wb, 'Đáp án', COLOR.key, [
    { header: 'Mã câu hỏi', width: 38 }, { header: 'Loại', width: 15 }, { header: 'Câu hỏi', width: 55 },
    { header: 'Các lựa chọn', width: 50 }, { header: 'Đáp án đúng', width: 35 }, { header: 'Đáp án tham khảo (tự luận)', width: 60 },
    { header: 'Điểm', width: 9 },
  ]);

  const essayCol = (i: number) => essay.getColumn(i).letter;
  const essayIdCol = essayCol(2), essayMaxCol = essayCol(15), essayScoreCol = essayCol(16);
  let mcNo = 0, essayNo = 0;
  for (const a of input.attempts) {
    const who = [a.id, escapeCell(a.full_name), escapeCell(a.normalized_email)];
    const profile = [escapeCell(a.position), escapeCell(a.candidate_level), escapeCell(a.main_project)];
    const times = [vnDate(a.started_at), vnDate(a.submitted_at), durationDays(a.started_at, a.submitted_at)];
    const total = a.total_points ?? 0;
    const correct = a.correct_count ?? 0;
    const essayCount = a.question_order.filter((id) => questionMap.get(id)?.question_type === 'essay').length;
    const row = mc.addRow([
      ++mcNo, ...who, ...profile, ...times, total, correct, a.incorrect_count ?? Math.max(total - correct, 0),
      a.scored_points ?? correct, total, total > 0 ? correct / total : null,
      a.result === 'PASS' ? 'ĐẠT' : a.result === 'FAIL' ? 'KHÔNG ĐẠT' : total === 0 ? 'Không có trắc nghiệm' : '',
      essayCount > 0 ? { formula: `SUMIFS('Kết quả tự luận'!$${essayScoreCol}:$${essayScoreCol},'Kết quả tự luận'!$${essayIdCol}:$${essayIdCol},$B${mcNo + 1})`, result: 0 } : 'Không có',
      essayCount > 0 ? { formula: `SUMIFS('Kết quả tự luận'!$${essayMaxCol}:$${essayMaxCol},'Kết quả tự luận'!$${essayIdCol}:$${essayIdCol},$B${mcNo + 1})`, result: 0 } : 'Không có',
    ]);
    row.getCell(8).numFmt = DATE_FORMAT; row.getCell(9).numFmt = DATE_FORMAT; row.getCell(10).numFmt = DURATION_FORMAT;
    row.getCell(16).numFmt = '0.0%';
    const verdict = row.getCell(17);
    if (a.result === 'PASS') tone(verdict, 'ok'); else if (a.result === 'FAIL') tone(verdict, 'bad'); else tone(verdict, 'warn');

    const reviewPath = `pdfs/${reviewPdfName(a, mcNo - 1)}`;
    const reviewRow = review.addRow([
      mcNo, ...who, ...profile, ...times, a.scored_points ?? correct,
      a.result === 'PASS' ? 'ĐẠT' : a.result === 'FAIL' ? 'KHÔNG ĐẠT' : 'Chưa có kết quả',
      { text: reviewPath, hyperlink: reviewPath },
    ]);
    reviewRow.getCell(8).numFmt = DATE_FORMAT;
    reviewRow.getCell(9).numFmt = DATE_FORMAT;
    reviewRow.getCell(10).numFmt = DURATION_FORMAT;
    reviewRow.getCell(13).font = { color: { argb: 'FF1D4ED8' }, underline: true };
    tone(reviewRow.getCell(12), a.result === 'PASS' ? 'ok' : a.result === 'FAIL' ? 'bad' : 'warn');

    a.question_order.forEach((questionId, index) => {
      const q = questionMap.get(questionId);
      if (!q) return;
      const answer = answerMap.get(`${a.id}:${questionId}`);
      if (q.question_type === 'essay') {
        const r = essay.addRow([
          ++essayNo, ...who, ...profile, ...times, index + 1, escapeCell(q.question_text),
          escapeCell(answer?.essay_response ?? ''), escapeCell(keyOf(q).reference_answer ?? ''), q.points, null, '',
        ]);
        r.getCell(8).numFmt = DATE_FORMAT; r.getCell(9).numFmt = DATE_FORMAT; r.getCell(10).numFmt = DURATION_FORMAT;
        const score = r.getCell(16);
        score.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.inputFill } };
        score.dataValidation = {
          type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, q.points],
          showErrorMessage: true, errorTitle: 'Điểm không hợp lệ', error: `Nhập điểm từ 0 đến ${q.points}.`,
        };
        r.getCell(17).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR.inputFill } };
        return;
      }
    });
  }

  for (const q of input.questions) {
    const options = q.options ?? [];
    const key = keyOf(q);
    keySheet.addRow([
      q.id, TYPE_LABEL[q.question_type], escapeCell(q.question_text),
      escapeCell(options.map((o) => `${o.id.toUpperCase()}. ${o.text}`).join('\n')),
      escapeCell((key.correct_options ?? []).map((id) => label(options, id)).join('\n')),
      escapeCell(key.reference_answer ?? ''), q.question_type === 'essay' ? q.points : 1,
    ]);
  }

  for (const ws of [mc, essay, review, keySheet]) finish(ws);
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}
