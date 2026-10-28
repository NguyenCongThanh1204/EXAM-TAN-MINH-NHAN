import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import type { ExportAnswer, ExportAttempt, ExportQuestion } from './workbook.js';

const FONT_REGULAR = readFileSync(new URL('../../node_modules/@fontsource/tinos/files/tinos-vietnamese-400-normal.woff', import.meta.url));
const FONT_BOLD = readFileSync(new URL('../../node_modules/@fontsource/tinos/files/tinos-vietnamese-700-normal.woff', import.meta.url));
const FONT_REGULAR_LATIN = readFileSync(new URL('../../node_modules/@fontsource/tinos/files/tinos-latin-400-normal.woff', import.meta.url));
const FONT_BOLD_LATIN = readFileSync(new URL('../../node_modules/@fontsource/tinos/files/tinos-latin-700-normal.woff', import.meta.url));
const FONT_REGULAR_LATIN_EXT = readFileSync(new URL('../../node_modules/@fontsource/tinos/files/tinos-latin-ext-400-normal.woff', import.meta.url));
const FONT_BOLD_LATIN_EXT = readFileSync(new URL('../../node_modules/@fontsource/tinos/files/tinos-latin-ext-700-normal.woff', import.meta.url));
const COMPANY_LOGO = readFileSync(new URL('../../public/logo.png', import.meta.url));
const VN_TIME = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'medium',
});

type FontSubset = 'latin' | 'latin-ext' | 'vietnamese';
type PdfTextOptions = PDFKit.Mixins.TextOptions;
type PdfDocument = InstanceType<typeof PDFDocument>;
type FontRun = { font: FontSubset; text: string };

export function fontSubsetForCharacter(character: string): FontSubset {
  const codePoint = character.codePointAt(0) ?? 0;
  if (
    /[ăđơưĂĐƠƯ]/u.test(character)
    || (codePoint >= 0x1ea0 && codePoint <= 0x1ef9)
  ) return 'vietnamese';
  return codePoint <= 0xff ? 'latin' : 'latin-ext';
}

export function hasExactCorrectOptions(selected: string[], correct: string[]): boolean {
  return correct.length > 0
    && selected.length === correct.length
    && selected.every((id) => correct.includes(id));
}

const safeFilenamePart = (value: string, fallback: string) => {
  const slug = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (letter) => letter === 'Đ' ? 'D' : 'd')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return slug || fallback;
};

export const reviewPdfName = (attempt: ExportAttempt, index: number) =>
  `${String(index + 1).padStart(4, '0')}_${safeFilenamePart(attempt.full_name, 'ThiSinh')}_${safeFilenamePart(attempt.main_project, 'CongTrinhChinh')}.pdf`;

const runFontName = (run: FontRun, bold: boolean) => `Tinos-${run.font}${bold ? '-Bold' : ''}`;

function splitRuns(line: string): FontRun[] {
  const runs: FontRun[] = [];
  for (const character of line) {
    const font = fontSubsetForCharacter(character);
    const last = runs[runs.length - 1];
    if (last?.font === font) last.text += character;
    else runs.push({ font, text: character });
  }
  return runs;
}

// Vẽ MỘT dòng (không chứa \n).
function writeLine(doc: PdfDocument, line: string, options: PdfTextOptions, bold: boolean, isLastLine: boolean) {
  const runs = splitRuns(line);
  const keepContinued = isLastLine && options.continued;

  // Dòng trống hoặc chỉ có một font: vẽ bình thường.
  if (runs.length <= 1) {
    const run = runs[0] ?? { font: 'latin' as FontSubset, text: ' ' };
    doc.font(runFontName(run, bold)).text(run.text, { ...options, continued: keepContinued });
    return;
  }

  // Căn giữa / căn phải: tự tính vị trí, vẽ từng đoạn ở toạ độ tuyệt đối
  // (PDFKit sẽ căn từng đoạn riêng nếu dùng continued + align -> bị đè chữ).
  if (options.align === 'center' || options.align === 'right') {
    const widths = runs.map((run) => doc.font(runFontName(run, bold)).widthOfString(run.text));
    const total = widths.reduce((sum, width) => sum + width, 0);
    const left = doc.page.margins.left;
    const usable = doc.page.width - left - doc.page.margins.right;
    if (total <= usable) {
      let x = left + (options.align === 'center' ? (usable - total) / 2 : usable - total);
      const y = doc.y;
      const lineHeight = doc.currentLineHeight(true);
      runs.forEach((run, index) => {
        doc.font(runFontName(run, bold)).text(run.text, x, y, { lineBreak: false });
        x += widths[index];
      });
      doc.x = left;
      doc.y = y + lineHeight;
      return;
    }
    // Dòng quá dài không vừa một hàng: rơi xuống cách vẽ nối bên dưới.
  }

  // Căn trái: nối các đoạn bằng continued.
  runs.forEach((run, index) => {
    doc.font(runFontName(run, bold)).text(run.text, {
      ...options,
      continued: index < runs.length - 1 || keepContinued,
    });
  });
}

function writeText(doc: PdfDocument, value: string, options: PdfTextOptions = {}, bold = false) {
  // Tách theo \n trước để không có \n nằm giữa chuỗi continued.
  const lines = value.normalize('NFC').split(/\r\n|\r|\n/);
  lines.forEach((line, index) => writeLine(doc, line, options, bold, index === lines.length - 1));
  return doc;
}

function registerFonts(doc: PdfDocument) {
  doc.registerFont('Tinos-latin', FONT_REGULAR_LATIN);
  doc.registerFont('Tinos-latin-Bold', FONT_BOLD_LATIN);
  doc.registerFont('Tinos-latin-ext', FONT_REGULAR_LATIN_EXT);
  doc.registerFont('Tinos-latin-ext-Bold', FONT_BOLD_LATIN_EXT);
  doc.registerFont('Tinos-vietnamese', FONT_REGULAR);
  doc.registerFont('Tinos-vietnamese-Bold', FONT_BOLD);
}

function writeAlignedText(
  doc: PdfDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  color: string,
  bold: boolean,
  align: 'center' | 'right',
) {
  const runs = splitRuns(value.normalize('NFC'));
  const runWidths = runs.map((run) => doc.font(runFontName(run, bold)).fontSize(fontSize).widthOfString(run.text));
  const totalWidth = runWidths.reduce((sum, runWidth) => sum + runWidth, 0);
  let cursor = x + (align === 'center' ? Math.max(0, (width - totalWidth) / 2) : Math.max(0, width - totalWidth));
  runs.forEach((run, index) => {
    doc.font(runFontName(run, bold)).fontSize(fontSize).fillColor(color)
      .text(run.text, cursor, y, { lineBreak: false });
    cursor += runWidths[index];
  });
}

export const violationNotice = (reason: string | null | undefined) =>
  reason === 'tab_switch' ? 'VI PHẠM QUY ĐỊNH: CHUYỂN TAB' : null;

function writePdfHeader(doc: PdfDocument, submitReason: string | null | undefined) {
  doc.image(COMPANY_LOGO, 46, 49, { width: 95 });
  writeAlignedText(doc, 'TÂN MINH NHÂN', 46, 55, 503, 16, '#0b44c9', true, 'center');
  const notice = violationNotice(submitReason);
  if (notice) writeAlignedText(doc, notice, 360, 59, 189, 10, '#b91c1c', true, 'right');
  doc.x = doc.page.margins.left;
  doc.y = 89;
}

const time = (value: string | null) => value ? VN_TIME.format(new Date(value)) : 'Chưa có';
const duration = (start: string, end: string | null) => {
  if (!end) return 'Chưa có';
  const seconds = Math.max(0, Math.floor((Date.parse(end) - Date.parse(start)) / 1000));
  return `${Math.floor(seconds / 3600)} giờ ${Math.floor((seconds % 3600) / 60)} phút ${seconds % 60} giây`;
};

type CandidatePdfQuestion = Pick<ExportQuestion, 'id' | 'question_text' | 'options' | 'question_type'>;
type CandidatePdfAnswer = Pick<ExportAnswer, 'question_id' | 'selected_options' | 'essay_response'>;
type CandidatePdfAttempt = Pick<ExportAttempt,
  'full_name' | 'normalized_email' | 'position' | 'candidate_level' | 'main_project'
  | 'question_order' | 'started_at' | 'submitted_at'> & { submit_reason?: string | null };

export const candidatePdfName = (attempt: Pick<CandidatePdfAttempt, 'full_name' | 'main_project'>) =>
  `Bai_lam_${safeFilenamePart(attempt.full_name, 'ThiSinh')}_${safeFilenamePart(attempt.main_project, 'CongTrinhChinh')}.pdf`;

export const candidateOptionLine = (id: string, text: string) =>
  `${id.toUpperCase()}. ${text}`;

export function buildCandidatePdf(input: {
  attempt: CandidatePdfAttempt;
  questions: CandidatePdfQuestion[];
  answers: CandidatePdfAnswer[];
}): Promise<Buffer> {
  const questionMap = new Map(input.questions.map((question) => [question.id, question]));
  const answerMap = new Map(input.answers.map((answer) => [answer.question_id, answer]));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    registerFonts(doc);

    writePdfHeader(doc, input.attempt.submit_reason);
    doc.fontSize(11).fillColor('#475569');
    writeText(doc, 'Bài kiểm tra nội bộ', { align: 'center' });
    doc.moveDown(0.8);
    doc.moveTo(46, doc.y).lineTo(549, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(0.6);

    doc.fontSize(13).fillColor('#0b44c9');
    writeText(doc, 'THÔNG TIN THÍ SINH', {}, true);
    doc.fontSize(13).fillColor('#0f172a');
    [
      `Họ và tên: ${input.attempt.full_name}`,
      `Email: ${input.attempt.normalized_email}`,
      `Chức danh: ${input.attempt.position}    Cấp bậc: ${input.attempt.candidate_level}`,
      `Công trình chính: ${input.attempt.main_project}`,
      `Bắt đầu: ${time(input.attempt.started_at)}`,
      `Nộp bài: ${time(input.attempt.submitted_at)}    Thời lượng: ${duration(input.attempt.started_at, input.attempt.submitted_at)}`,
    ].forEach((line) => writeText(doc, line));
    doc.moveDown(0.8);
    doc.moveTo(46, doc.y).lineTo(549, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(0.7);

    input.attempt.question_order.forEach((id, index) => {
      const question = questionMap.get(id);
      if (!question) throw new Error(`Không tìm thấy câu hỏi ${id} trong bài làm đã nộp.`);
      const answer = answerMap.get(id);
      doc.fontSize(13).fillColor('#1d4ed8');
      writeText(doc, `Câu ${index + 1} · ${question.question_type === 'essay' ? 'TỰ LUẬN' : question.question_type === 'multiple' ? 'TRẮC NGHIỆM NHIỀU ĐÁP ÁN' : 'TRẮC NGHIỆM MỘT ĐÁP ÁN'}`, {}, true);
      doc.fontSize(13).fillColor('#0f172a');
      writeText(doc, question.question_text, { indent: 8 });

      if (question.question_type === 'essay') {
        doc.moveDown(0.2);
        doc.fillColor('#334155');
        writeText(doc, 'Bài làm của bạn:', {}, true);
        doc.fillColor('#0f172a');
        writeText(doc, answer?.essay_response?.trim() || '(Bỏ trống)', { indent: 8 });
      } else {
        const selected = answer?.selected_options ?? [];
        for (const option of question.options ?? []) {
          const isSelected = selected.includes(option.id);
          doc.fontSize(13).fillColor(isSelected ? '#0f766e' : '#0f172a');
          writeText(doc, candidateOptionLine(option.id, option.text), { indent: 12 }, isSelected);
        }
        if (selected.length === 0) {
          doc.fillColor('#64748b');
          writeText(doc, 'Bạn chưa chọn đáp án.', { indent: 12 });
        }
      }
      doc.moveDown(0.8);
    });

    doc.end();
  });
}

export function buildReviewPdf(input: {
  attempt: ExportAttempt;
  questions: ExportQuestion[];
  answers: ExportAnswer[];
}): Promise<Buffer> {
  const questionMap = new Map(input.questions.map((question) => [question.id, question]));
  const answerMap = new Map(input.answers.map((answer) => [answer.question_id, answer]));
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 46, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    registerFonts(doc);

    const a = input.attempt;
    writePdfHeader(doc, a.submit_reason);
    doc.fontSize(11).fillColor('#475569');
    writeText(doc, 'Bài kiểm tra nội bộ', { align: 'center' });
    doc.moveDown(0.8);
    doc.moveTo(46, doc.y).lineTo(549, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(0.6);

    doc.fontSize(13).fillColor('#0b44c9');
    writeText(doc, 'THÔNG TIN THÍ SINH', {}, true);
    doc.fontSize(13).fillColor('#0f172a');
    [
      `Họ và tên: ${a.full_name}`,
      `Email: ${a.normalized_email}`,
      `Chức danh: ${a.position}    Cấp bậc: ${a.candidate_level}`,
      `Công trình chính: ${a.main_project}`,
      `Bắt đầu: ${time(a.started_at)}`,
      `Nộp bài: ${time(a.submitted_at)}    Thời lượng: ${duration(a.started_at, a.submitted_at)}`,
      `Kết quả trắc nghiệm: ${a.scored_points ?? 0}/${a.total_points ?? 0} điểm    ${a.result === 'PASS' ? 'ĐẠT' : a.result === 'FAIL' ? 'KHÔNG ĐẠT' : 'Chưa có kết quả'}`,
    ].forEach((line) => writeText(doc, line));
    doc.moveDown(0.8);
    doc.moveTo(46, doc.y).lineTo(549, doc.y).strokeColor('#cbd5e1').stroke();
    doc.moveDown(0.7);

    a.question_order.forEach((id, index) => {
      const question = questionMap.get(id);
      if (!question) throw new Error(`Không tìm thấy câu hỏi ${id} của bài thi ${a.id}.`);
      const answer = answerMap.get(id);
      const keys = Array.isArray(question.question_keys) ? question.question_keys[0] : question.question_keys;
      const correct = keys?.correct_options ?? [];
      const options = question.options ?? [];

      doc.fontSize(13).fillColor('#1d4ed8');
      writeText(doc, `Câu ${index + 1} · ${question.question_type === 'essay' ? 'TỰ LUẬN' : question.question_type === 'multiple' ? 'TRẮC NGHIỆM NHIỀU ĐÁP ÁN' : 'TRẮC NGHIỆM MỘT ĐÁP ÁN'}`, {}, true);
      doc.fontSize(13).fillColor('#0f172a');
      writeText(doc, question.question_text, { indent: 8 });
      if (question.question_type === 'essay') {
        doc.moveDown(0.2);
        doc.fillColor('#334155');
        writeText(doc, 'Bài làm của thí sinh:', {}, true);
        doc.fillColor('#0f172a');
        writeText(doc, answer?.essay_response?.trim() || '(Bỏ trống)', { indent: 8 });
      } else {
        const selected = answer?.selected_options ?? [];
        for (const option of options) {
          const isSelected = selected.includes(option.id);
          const isCorrect = correct.includes(option.id);
          doc.fontSize(13).fillColor(isSelected ? (isCorrect ? '#047857' : '#b91c1c') : '#0f172a');
          writeText(doc, `${option.id.toUpperCase()}. ${option.text}`, { indent: 12 }, isSelected);
        }
        if (!hasExactCorrectOptions(selected, correct)) {
          doc.fontSize(13).fillColor('#334155');
          writeText(doc, 'Đáp án đúng: ', { indent: 12, continued: true }, true);
          doc.fillColor('#047857');
          writeText(doc, correct.length ? correct.map((id) => id.toUpperCase()).join(', ') : 'Chưa thiết lập');
        }
      }
      doc.moveDown(0.8);
    });

    const pages = doc.bufferedPageRange();
    // for (let page = 0; page < pages.count; page++) {
    //   doc.switchToPage(pages.start + page);
    //   doc.font('Tinos-latin').fontSize(9).fillColor('#64748b')
    //     .text(`Mã bài thi ${a.id} · Trang ${page + 1}/${pages.count}`, 46, 795, { width: 503, align: 'center', lineBreak: false });
    // }
    doc.end();
  });
}