import ExcelJS from 'exceljs';
import { escapeCell } from './pure.js';
import { adminResultPdfName } from './review-pdf.js';
import { scoreOutOfTen } from './scoring.js';

type Option = { id: string; text: string };
type Key = { correct_options: string[] | null; reference_answer: string | null };
export type ExportAttempt = {
  id: string; full_name: string; normalized_email: string; position: string;
  candidate_level: string; main_project: string; question_order: string[];
  correct_count: number | null; incorrect_count: number | null;
  scored_points: number | null; total_points: number | null; result: string | null;
  started_at: string; submitted_at: string | null; submit_reason?: string | null;
  participant_order?: number | null;
  participant_list_name?: string | null;
};
export type ExportQuestion = {
  id: string; question_text: string; options: Option[] | null;
  question_type: 'single' | 'multiple' | 'essay'; points: number;
  question_keys?: Key | Key[] | null;
};
export type ExportAnswer = {
  attempt_id: string; question_id: string; selected_options: string[] | null; essay_response: string | null;
  essay_passed?: boolean | null;
};

const COLOR = {
  mc: 'FF0F766E', essay: 'FFB45309', detail: 'FF1D4ED8', key: 'FF475569',
  okFill: 'FFD1FAE5', okFont: 'FF065F46', badFill: 'FFFEE2E2', badFont: 'FF991B1B',
  warnFill: 'FFFEF3C7', border: 'FFCBD5E1',
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

export function orderExportAttempts(attempts: ExportAttempt[]): ExportAttempt[] {
  return [...attempts].sort((a, b) => {
    const orderA = a.participant_order ?? Number.POSITIVE_INFINITY;
    const orderB = b.participant_order ?? Number.POSITIVE_INFINITY;
    return orderA - orderB
      || Date.parse(a.started_at) - Date.parse(b.started_at)
      || a.id.localeCompare(b.id);
  });
}

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

  const summary = addSheet(wb, 'Kết quả', COLOR.detail, [
    { header: 'STT', width: 8 }, { header: 'HỌ VÀ TÊN', width: 28 },
    { header: 'CẤP BẬC', width: 18 }, { header: 'CHỨC DANH', width: 22 },
    { header: 'ĐỊA ĐIỂM THI', width: 30 }, { header: 'TRẮC NGHIỆM', width: 16 },
    { header: 'TỰ LUẬN', width: 16 }, { header: 'TỔNG ĐIỂM', width: 16 },
    { header: 'THỜI GIAN LÀM BÀI', width: 22 }, { header: 'XẾP LOẠI', width: 18 },
    { header: 'GHI CHÚ', width: 34 },
  ]);
  const mc = addSheet(wb, 'Kết quả tổng kết', COLOR.mc, [
    { header: 'STT', width: 7 }, ...person, ...candidate,
    { header: 'Số câu trắc nghiệm', width: 14 }, { header: 'Số câu đúng', width: 12 }, { header: 'Số câu sai / bỏ trống', width: 14 },
    { header: 'Tổng điểm (thang 10)', width: 16 }, { header: 'Điểm tối đa (thang 10)', width: 15 },
    { header: 'Điểm trắc nghiệm (0,5/câu)', width: 16 }, { header: 'Điểm tự luận quy đổi', width: 16 },
    { header: 'Kết quả tổng kết', width: 17 },
  ]);
  const essay = addSheet(wb, 'Kết quả tự luận', COLOR.essay, [
    { header: 'STT', width: 7 }, ...person, ...candidate,
    { header: 'Câu số', width: 8 }, { header: 'Câu hỏi tự luận', width: 50 }, { header: 'Bài làm của thí sinh', width: 60 },
    { header: 'Đáp án tham khảo', width: 55 }, { header: 'Kết quả chấm', width: 18 },
    { header: 'Điểm quy đổi (Đạt = 0,5)', width: 20 },
  ]);
  const review = addSheet(wb, 'Hồ sơ phúc khảo', COLOR.detail, [
    { header: 'STT', width: 7 }, ...person, ...candidate,
    { header: 'Tổng điểm (thang 10)', width: 20 }, { header: 'Kết quả cuối', width: 18 },
    { header: 'Tệp PDF phúc khảo (trong ZIP)', width: 42 },
  ]);
  const keySheet = addSheet(wb, 'Đáp án', COLOR.key, [
    { header: 'Mã câu hỏi', width: 38 }, { header: 'Loại', width: 15 }, { header: 'Câu hỏi', width: 55 },
    { header: 'Các lựa chọn', width: 50 }, { header: 'Đáp án đúng', width: 35 }, { header: 'Đáp án tham khảo (tự luận)', width: 60 },
    { header: 'Trọng số câu / điểm tối đa tự luận', width: 38 },
  ]);

  const essayCol = (i: number) => essay.getColumn(i).letter;
  const essayIdCol = essayCol(2);
  const essayConvertedCol = essayCol(16);
  for (const a of orderExportAttempts(input.attempts)) {
    const sequenceNumber = a.participant_order;
    if (sequenceNumber === null || sequenceNumber === undefined)
      throw new Error(`Không có STT danh sách email cho bài thi ${a.id}.`);
    const who = [a.id, escapeCell(a.full_name), escapeCell(a.normalized_email)];
    const profile = [escapeCell(a.position), escapeCell(a.candidate_level), escapeCell(a.main_project)];
    const times = [vnDate(a.started_at), vnDate(a.submitted_at), durationDays(a.started_at, a.submitted_at)];
    const total = a.question_order.filter((id) => questionMap.get(id)?.question_type !== 'essay').length;
    const correct = a.correct_count ?? 0;
    const mcScore = correct * 0.5;
    const finalScore = scoreOutOfTen(a.scored_points, a.total_points);
    const essayCount = a.question_order.filter((id) => questionMap.get(id)?.question_type === 'essay').length;
    const essayAnswers = a.question_order
      .filter((id) => questionMap.get(id)?.question_type === 'essay')
      .map((id) => answerMap.get(`${a.id}:${id}`)?.essay_passed);
    const essayScore = essayCount === 0 ? 0
      : essayAnswers.every((passed) => passed !== null && passed !== undefined)
        ? essayAnswers.reduce((total, passed) => total + (passed ? 0.5 : 0), 0)
        : null;
    const rating = a.result === 'PASS' ? 'ĐẠT'
      : a.result === 'FAIL' ? 'KHÔNG ĐẠT'
        : essayCount > 0 ? 'Chờ chấm tự luận' : 'Chưa có kết quả';
    const summaryRow = summary.addRow([
      sequenceNumber, escapeCell(a.full_name), escapeCell(a.candidate_level), escapeCell(a.position),
      escapeCell(a.main_project), mcScore, essayScore, finalScore,
      durationDays(a.started_at, a.submitted_at), rating,
      a.submit_reason === 'tab_switch' ? 'Vi phạm quy chế thi: chuyển tab' : '',
    ]);
    for (const column of [6, 7, 8]) summaryRow.getCell(column).numFmt = '0.00';
    summaryRow.getCell(9).numFmt = DURATION_FORMAT;
    if (a.result === 'PASS') tone(summaryRow.getCell(10), 'ok');
    else if (a.result === 'FAIL') tone(summaryRow.getCell(10), 'bad');
    else tone(summaryRow.getCell(10), 'warn');
    if (a.submit_reason === 'tab_switch') tone(summaryRow.getCell(11), 'bad');

    const row = mc.addRow([
      sequenceNumber, ...who, ...profile, ...times, total, correct, a.incorrect_count ?? Math.max(total - correct, 0),
      finalScore, 10, mcScore,
      essayCount > 0
        ? { formula: `SUMIFS('Kết quả tự luận'!$${essayConvertedCol}:$${essayConvertedCol},'Kết quả tự luận'!$${essayIdCol}:$${essayIdCol},$B${mc.rowCount + 1})`, result: 0 }
        : 0,
      a.result === 'PASS' ? 'ĐẠT' : a.result === 'FAIL' ? 'KHÔNG ĐẠT' : essayCount > 0 ? 'Chờ chấm tự luận' : 'Chưa có kết quả',
    ]);
    row.getCell(8).numFmt = DATE_FORMAT; row.getCell(9).numFmt = DATE_FORMAT; row.getCell(10).numFmt = DURATION_FORMAT;
    row.getCell(14).numFmt = '0.00'; row.getCell(15).numFmt = '0.00';
    row.getCell(16).numFmt = '0.00'; row.getCell(17).numFmt = '0.00';
    const verdict = row.getCell(18);
    if (a.result === 'PASS') tone(verdict, 'ok'); else if (a.result === 'FAIL') tone(verdict, 'bad'); else tone(verdict, 'warn');

    const reviewPath = `pdfs/${adminResultPdfName(a, sequenceNumber)}`;
    const reviewRow = review.addRow([
      sequenceNumber, ...who, ...profile, ...times, finalScore,
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
        const rowNumber = essay.rowCount + 1;
        const passed = answer?.essay_passed ?? null;
        const r = essay.addRow([
          sequenceNumber, ...who, ...profile, ...times, index + 1, escapeCell(q.question_text),
          escapeCell(answer?.essay_response ?? ''), escapeCell(keyOf(q).reference_answer ?? ''),
          passed === null ? null : passed ? 'ĐẠT' : 'KHÔNG ĐẠT',
          { formula: `IF(O${rowNumber}="","",IF(O${rowNumber}="ĐẠT",0.5,0))`, result: passed === null ? null : passed ? 0.5 : 0 },
        ]);
        r.getCell(8).numFmt = DATE_FORMAT; r.getCell(9).numFmt = DATE_FORMAT; r.getCell(10).numFmt = DURATION_FORMAT;
        r.getCell(16).numFmt = '0.00';
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
      escapeCell(key.reference_answer ?? ''), 0.5,
    ]);
  }

  for (const ws of [summary, mc, essay, review, keySheet]) finish(ws);
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}
