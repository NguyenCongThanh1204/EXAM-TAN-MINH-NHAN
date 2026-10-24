import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph } from 'docx';
import { parseRows, parseText } from './import';

describe('real files round-trip', () => {
  it('docx → mammoth → parseText', async () => {
    const lines = ['1. Thủ đô của Việt Nam là?', 'A. Hà Nội', 'B. Huế', 'Đáp án: A', '', 'Câu 2: Một năm có mấy tháng?', 'A. 10', 'B. 12', 'Đáp án: B'];
    const buf = await Packer.toBuffer(new Document({ sections: [{ children: lines.map((t) => new Paragraph(t)) }] }));
    const r = parseText((await mammoth.extractRawText({ buffer: buf })).value);
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.correct)).toEqual([['a'], ['b']]);
    expect(r.items[0].text).toBe('Thủ đô của Việt Nam là?');
  });
  it('xlsx → exceljs → parseRows', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.addRow(['Câu hỏi', 'A', 'B', 'C', 'D', 'E', 'F', 'Đáp án đúng', 'Loại', 'Điểm', 'Đáp án tham khảo']);
    ws.addRow(['=2+2 là?', '3', '4', '', '', '', '', 'B', 'single', 1, '']);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load((await wb.xlsx.writeBuffer()) as ExcelJS.Buffer);
    const rows: { n: number; cells: string[] }[] = [];
    loaded.worksheets[0].eachRow({ includeEmpty: false }, (row, n) => rows.push({ n, cells: Array.from({ length: 11 }, (_, i) => String(row.getCell(i + 1).text ?? '').trim()) }));
    const r = parseRows(rows);
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].correct).toEqual(['b']);
  });
});
