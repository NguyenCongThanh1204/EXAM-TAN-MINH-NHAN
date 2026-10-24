export type Item = {
  text: string;
  type: 'single' | 'multiple' | 'essay';
  points: number;
  options: { id: string; text: string }[];
  correct: string[];
  referenceAnswer: string;
};
export type Err = { ref: string; message: string };
type Raw = {
  ref: string; text: string; opts: { k: string; t: string }[]; ans: string;
  type: string; points: string; referenceAnswer: string;
};
const L = 'ABCDEF';
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const parseType = (s: string): Item['type'] | null => {
  const t = s.trim().toLowerCase();
  if (!t || ['single', 'một đáp án', 'trắc nghiệm một đáp án'].includes(t)) return 'single';
  if (['multiple', 'nhiều đáp án', 'trắc nghiệm nhiều đáp án'].includes(t)) return 'multiple';
  if (['essay', 'tự luận'].includes(t)) return 'essay';
  return null;
};
const parseCorrect = (s: string) => [...new Set(s.toUpperCase().match(/[A-F]/g) ?? [])].map((v) => v.toLowerCase());

/** Shared validation for both Excel and Word sources. */
export function build(raws: Raw[]): { items: Item[]; errors: Err[] } {
  const items: Item[] = [], errors: Err[] = [], seen = new Map<string, string>();
  for (const r of raws) {
    const before = errors.length;
    const e = (message: string) => errors.push({ ref: r.ref, message });
    const text = clean(r.text);
    if (!text) e('Thiếu nội dung câu hỏi.'); else if (text.length > 2000) e('Câu hỏi quá dài (tối đa 2000 ký tự).');
    const type = parseType(r.type);
    if (!type) e(`Loại câu hỏi "${r.type}" không hợp lệ. Dùng single, multiple hoặc essay.`);
    // Mỗi câu trắc nghiệm luôn 1 điểm; cột điểm chỉ áp dụng cho câu tự luận.
    const points = type === 'essay' ? (r.points.trim() ? Number(r.points) : 1) : 1;
    if (!Number.isFinite(points) || points <= 0 || points > 1000) e('Điểm tối đa của câu tự luận phải lớn hơn 0 và không quá 1000.');
    if (type === 'essay') {
      if (r.opts.some((o) => clean(o.t))) e('Câu tự luận không được có các lựa chọn A-F.');
      if (!clean(r.referenceAnswer)) e('Câu tự luận cần có đáp án tham khảo để admin chấm bài.');
      if (clean(r.referenceAnswer).length > 10000) e('Đáp án tham khảo quá dài (tối đa 10000 ký tự).');
    } else if (type) {
      if (r.opts.length < 2 || r.opts.length > 6) e('Cần từ 2 đến 6 đáp án.');
      else if (!r.opts.every((o, i) => o.k === L[i])) e('Các đáp án phải liên tục từ A, không bỏ trống.');
      if (r.opts.some((o) => !clean(o.t))) e('Có đáp án để trống.');
      if (r.opts.some((o) => o.t.length > 500)) e('Có đáp án quá dài (tối đa 500 ký tự).');
      const correct = parseCorrect(r.ans);
      if (!correct.length) e('Thiếu đáp án đúng.');
      if (type === 'single' && correct.length > 0 && correct.length !== 1) e('Câu một đáp án phải có đúng một đáp án đúng.');
      if (correct.some((ans) => !r.opts.some((o) => o.k.toLowerCase() === ans)))
        e(`Đáp án đúng "${r.ans}" không khớp với các lựa chọn.`);
    }
    const key = text.toLowerCase();
    if (text) { const p = seen.get(key); if (p) e(`Trùng nội dung với ${p}.`); else seen.set(key, r.ref); }
    if (errors.length === before) items.push({
      text, type: type!, points, options: r.opts.map((o) => ({ id: o.k.toLowerCase(), text: clean(o.t) })),
      correct: type === 'essay' ? [] : parseCorrect(r.ans), referenceAnswer: clean(r.referenceAnswer),
    });
  }
  if (!raws.length) errors.push({ ref: 'Tệp', message: 'Không tìm thấy câu hỏi nào.' });
  return { items, errors };
}

/** Excel: A question, B-G options, H correct letters, I type, J points, K reference answer. */
export function parseRows(rows: { n: number; cells: string[] }[]) {
  const raws: Raw[] = [];
  for (const { n, cells } of rows) {
    if (cells.every((c) => !c.trim())) continue;
    if (/^(câu hỏi|question)$/i.test(cells[0].trim())) continue;
    raws.push({
      ref: `Dòng ${n}`, text: cells[0] ?? '',
      opts: cells.slice(1, 7).map((t, i) => ({ k: L[i], t: t.trim() })).filter((o) => o.t),
      ans: cells[7] ?? '', type: cells[8] ?? '', points: cells[9] ?? '', referenceAnswer: cells[10] ?? '',
    });
  }
  return build(raws);
}

const QST = /^(?:câu\s*)?(\d{1,3})\s*[.):]\s*(.+)$/i;
const OPT = /^\(?([A-Fa-f])\s*[.):]\s*(.+)$/;
const ANS = /^(?:đáp\s*án(?:\s*đúng)?|dap\s*an|answer)\s*[:：]\s*(.*)$/i;
const TYPE = /^(?:loại|type)\s*[:：]\s*(.*)$/i;
const POINTS = /^(?:điểm|points?)\s*[:：]\s*(.*)$/i;
const REF = /^(?:đáp\s*án tham khảo|đáp án mẫu|reference answer)\s*[:：]\s*(.*)$/i;

/** Word: plain text of the document in the documented template format. */
export function parseText(input: string) {
  const raws: Raw[] = [];
  const stray: { ref: string; message: string }[] = [];
  let cur: Raw | null = null;
  let last: 'q' | 'o' | 'ref' | null = null;
  for (const line of input.normalize('NFC').split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    let m: RegExpMatchArray | null;
    if (cur && (m = l.match(ANS))) { cur.ans = m[1]; last = null; continue; }
    if (cur && (m = l.match(TYPE))) { cur.type = m[1]; last = null; continue; }
    if (cur && (m = l.match(POINTS))) { cur.points = m[1]; last = null; continue; }
    if (cur && (m = l.match(REF))) { cur.referenceAnswer = m[1]; last = 'ref'; continue; }
    if (cur && (m = l.match(OPT))) { cur.opts.push({ k: m[1].toUpperCase(), t: m[2] }); last = 'o'; continue; }
    if ((m = l.match(QST))) { cur = { ref: `Câu ${m[1]}`, text: m[2], opts: [], ans: '', type: '', points: '', referenceAnswer: '' }; raws.push(cur); last = 'q'; continue; }
    if (!cur) continue; // tiêu đề/hướng dẫn trước câu hỏi đầu tiên được bỏ qua
    if (last === 'q') cur.text += ' ' + l;
    else if (last === 'o') cur.opts[cur.opts.length - 1].t += ' ' + l;
    else if (last === 'ref') cur.referenceAnswer += ' ' + l;
    else stray.push({ ref: `Sau ${cur?.ref ?? 'đầu tệp'}`, message: `Dòng không nhận dạng được: "${l.slice(0, 60)}".` });
  }
  const r = build(raws);
  return { items: r.items, errors: [...stray, ...r.errors] };
}
