import { describe, expect, it } from 'vitest';
import { parseRows, parseText } from './import';

const row = (n: number, ...cells: string[]) => ({ n, cells: [...cells, ...Array(11).fill('')].slice(0, 11) });
describe('excel rows', () => {
  it('parses a valid row and skips header', () => {
    const r = parseRows([row(1, 'Câu hỏi', 'A', 'B', 'C', 'D', '', '', 'Đáp án đúng'), row(2, 'Thủ đô?', 'Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ', '', '', 'a')]);
    expect(r.errors).toEqual([]);
    expect(r.items[0]).toEqual({
      text: 'Thủ đô?', type: 'single', points: 1,
      options: ['Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ'].map((t, i) => ({ id: 'abcd'[i], text: t })),
      correct: ['a'], referenceAnswer: '',
    });
  });
  it('reports missing answer, bad answer, gap, duplicate', () => {
    const r = parseRows([row(2, 'Q1', 'x', 'y', '', '', '', '', ''), row(3, 'Q2', 'x', 'y', '', '', '', '', 'D'), row(4, 'Q3', 'x', '', 'z', '', '', '', 'A'), row(5, 'Q1', 'x', 'y', '', '', '', '', 'A')]);
    expect(r.items).toHaveLength(0);
    expect(r.errors.map((e) => e.ref)).toEqual(['Dòng 2', 'Dòng 3', 'Dòng 4', 'Dòng 5']);
  });
  it('imports multi-answer and essay question columns', () => {
    const r = parseRows([
      row(2, 'Chọn số nguyên tố', '2', '4', '5', '', '', '', 'A,C', 'multiple', '2', ''),
      row(3, 'Nêu giải pháp', '', '', '', '', '', '', '', 'essay', '5', 'Bảo vệ môi trường'),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.items.map(({ type, correct, points, referenceAnswer }) => ({ type, correct, points, referenceAnswer }))).toEqual([
      { type: 'multiple', correct: ['a', 'c'], points: 1, referenceAnswer: '' },
      { type: 'essay', correct: [], points: 5, referenceAnswer: 'Bảo vệ môi trường' },
    ]);
  });
});
describe('word text', () => {
  const doc = `1. Thủ đô của Việt Nam là?\nA. Hà Nội\nB. Huế\nC. Đà Nẵng\nD. Cần Thơ\nĐáp án: A\n\nCâu 2: Đa dạng sinh học là gì\ntiếp tục dòng hai?\nLoại: multiple\nĐiểm: 2\nA) Một\nB) Hai nối\ntiếp dòng\nĐáp án: A,B\n\n3. Trình bày giải pháp\nLoại: essay\nĐiểm: 5\nĐáp án tham khảo: Bảo vệ môi trường\n`;
  it('parses questions, multi-line text and options', () => {
    const r = parseText(doc);
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(3);
    expect(r.items[1]).toMatchObject({ text: 'Đa dạng sinh học là gì tiếp tục dòng hai?', type: 'multiple', points: 1, correct: ['a', 'b'] });
    expect(r.items[1].options[1].text).toBe('Hai nối tiếp dòng');
    expect(r.items[2]).toMatchObject({ type: 'essay', points: 5, correct: [], referenceAnswer: 'Bảo vệ môi trường' });
  });
  it('flags a question without answer line', () => {
    const r = parseText('1. Q?\nA. x\nB. y\n');
    expect(r.items).toHaveLength(0);
    expect(r.errors.some((e) => /đáp án đúng/i.test(e.message))).toBe(true);
  });
});
