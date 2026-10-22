export type Item = { text: string; options: { id: string; text: string }[]; correct: string };
export type Err = { ref: string; message: string };
type Raw = { ref: string; text: string; opts: { k: string; t: string }[]; ans: string };
const L = 'ABCDEF';
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Shared validation for both Excel and Word sources. */
export function build(raws: Raw[]): { items: Item[]; errors: Err[] } {
  const items: Item[] = [], errors: Err[] = [], seen = new Map<string, string>();
  for (const r of raws) {
    const before = errors.length;
    const e = (message: string) => errors.push({ ref: r.ref, message });
    const text = clean(r.text);
    if (!text) e('Thiếu nội dung câu hỏi.'); else if (text.length > 2000) e('Câu hỏi quá dài (tối đa 2000 ký tự).');
    if (r.opts.length < 2 || r.opts.length > 6) e('Cần từ 2 đến 6 đáp án.');
    else if (!r.opts.every((o, i) => o.k === L[i])) e('Các đáp án phải liên tục từ A, không bỏ trống.');
    if (r.opts.some((o) => !clean(o.t))) e('Có đáp án để trống.');
    if (r.opts.some((o) => o.t.length > 500)) e('Có đáp án quá dài (tối đa 500 ký tự).');
    const ans = r.ans.trim().toUpperCase();
    if (!ans) e('Thiếu đáp án đúng.');
    else if (!r.opts.some((o) => o.k === ans)) e(`Đáp án đúng "${r.ans}" không khớp với các lựa chọn.`);
    const key = text.toLowerCase();
    if (text) { const p = seen.get(key); if (p) e(`Trùng nội dung với ${p}.`); else seen.set(key, r.ref); }
    if (errors.length === before)
      items.push({ text, options: r.opts.map((o) => ({ id: o.k.toLowerCase(), text: clean(o.t) })), correct: ans.toLowerCase() });
  }
  if (!raws.length) errors.push({ ref: 'Tệp', message: 'Không tìm thấy câu hỏi nào.' });
  return { items, errors };
}

/** Excel: A=Câu hỏi, B..G = đáp án A..F, H = đáp án đúng. A header row is optional. */
export function parseRows(rows: { n: number; cells: string[] }[]) {
  const raws: Raw[] = [];
  for (const { n, cells } of rows) {
    if (cells.every((c) => !c.trim())) continue;
    if (/^(câu hỏi|question)$/i.test(cells[0].trim())) continue;
    raws.push({
      ref: `Dòng ${n}`, text: cells[0] ?? '',
      opts: cells.slice(1, 7).map((t, i) => ({ k: L[i], t: t.trim() })).filter((o) => o.t),
      ans: cells[7] ?? '',
    });
  }
  return build(raws);
}

const QST = /^(?:câu\s*)?(\d{1,3})\s*[.):]\s*(.+)$/i;
const OPT = /^\(?([A-Fa-f])\s*[.):]\s*(.+)$/;
const ANS = /^(?:đáp\s*án(?:\s*đúng)?|dap\s*an|answer)\s*[:：]\s*\(?([A-Fa-f])\b/i;

/** Word: plain text of the document in the documented template format. */
export function parseText(input: string) {
  const raws: Raw[] = [];
  const stray: { ref: string; message: string }[] = [];
  let cur: Raw | null = null;
  let last: 'q' | 'o' | null = null;
  for (const line of input.normalize('NFC').split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    let m: RegExpMatchArray | null;
    if (cur && (m = l.match(ANS))) { cur.ans = m[1]; last = null; continue; }
    if (cur && (m = l.match(OPT))) { cur.opts.push({ k: m[1].toUpperCase(), t: m[2] }); last = 'o'; continue; }
    if ((m = l.match(QST))) { cur = { ref: `Câu ${m[1]}`, text: m[2], opts: [], ans: '' }; raws.push(cur); last = 'q'; continue; }
    if (!cur) continue; // tiêu đề/hướng dẫn trước câu hỏi đầu tiên được bỏ qua
    if (last === 'q') cur.text += ' ' + l;
    else if (last === 'o') cur.opts[cur.opts.length - 1].t += ' ' + l;
    else stray.push({ ref: `Sau ${cur?.ref ?? 'đầu tệp'}`, message: `Dòng không nhận dạng được: "${l.slice(0, 60)}".` });
  }
  const r = build(raws);
  return { items: r.items, errors: [...stray, ...r.errors] };
}
