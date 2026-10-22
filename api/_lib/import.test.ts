import { describe, expect, it } from 'vitest';
import { parseRows, parseText } from './import';

const row = (n: number, ...cells: string[]) => ({ n, cells: [...cells, ...Array(8).fill('')].slice(0, 8) });
describe('excel rows', () => {
  it('parses a valid row and skips header', () => {
    const r = parseRows([row(1, 'Câu hỏi', 'A', 'B', 'C', 'D', '', '', 'Đáp án đúng'), row(2, 'Thủ đô?', 'Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ', '', '', 'a')]);
    expect(r.errors).toEqual([]);
    expect(r.items[0]).toEqual({ text: 'Thủ đô?', options: ['Hà Nội', 'Huế', 'Đà Nẵng', 'Cần Thơ'].map((t, i) => ({ id: 'abcd'[i], text: t })), correct: 'a' });
  });
  it('reports missing answer, bad answer, gap, duplicate', () => {
    const r = parseRows([row(2, 'Q1', 'x', 'y', '', '', '', '', ''), row(3, 'Q2', 'x', 'y', '', '', '', '', 'D'), row(4, 'Q3', 'x', '', 'z', '', '', '', 'A'), row(5, 'Q1', 'x', 'y', '', '', '', '', 'A')]);
    expect(r.items).toHaveLength(0);
    expect(r.errors.map((e) => e.ref)).toEqual(['Dòng 2', 'Dòng 3', 'Dòng 4', 'Dòng 5']);
  });
});
describe('word text', () => {
  const doc = `1. Thủ đô của Việt Nam là?\nA. Hà Nội\nB. Huế\nC. Đà Nẵng\nD. Cần Thơ\nĐáp án: A\n\nCâu 2: Đa dạng sinh học là gì\ntiếp tục dòng hai?\nA) Một\nB) Hai nối\ntiếp dòng\nĐáp án: B\n`;
  it('parses questions, multi-line text and options', () => {
    const r = parseText(doc);
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(2);
    expect(r.items[1].text).toBe('Đa dạng sinh học là gì tiếp tục dòng hai?');
    expect(r.items[1].options[1].text).toBe('Hai nối tiếp dòng');
    expect(r.items[1].correct).toBe('b');
  });
  it('flags a question without answer line', () => {
    const r = parseText('1. Q?\nA. x\nB. y\n');
    expect(r.items).toHaveLength(0);
    expect(r.errors[0].message).toMatch(/đáp án đúng/i);
  });
});
