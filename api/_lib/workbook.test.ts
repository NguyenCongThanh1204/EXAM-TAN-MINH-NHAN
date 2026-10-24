import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildResultsWorkbook } from './workbook.js';

const options = [{ id: 'a', text: 'Một' }, { id: 'b', text: 'Hai' }, { id: 'c', text: 'Ba' }];

describe('buildResultsWorkbook', () => {
  it('tách sheet trắc nghiệm và tự luận, có thời gian làm bài', async () => {
    const wb = buildResultsWorkbook({
      attempts: [{
        id: 'at1', full_name: 'Nguyen A', normalized_email: 'a@x.com', position: 'KS', candidate_level: 'Cấp 1',
        main_project: 'CT1', question_order: ['q1', 'q2', 'q3'], correct_count: 2, incorrect_count: 0,
        scored_points: 2, total_points: 2, result: 'PASS',
        started_at: '2026-01-01T01:00:00Z', submitted_at: '2026-01-01T01:30:00Z',
      }],
      questions: [
        { id: 'q1', question_text: 'Q1', options, question_type: 'single', points: 1, question_keys: { correct_options: ['a'], reference_answer: null } },
        { id: 'q2', question_text: 'Q2', options, question_type: 'multiple', points: 1, question_keys: [{ correct_options: ['a', 'c'], reference_answer: null }] },
        { id: 'q3', question_text: 'Q3', options: null, question_type: 'essay', points: 5, question_keys: { correct_options: [], reference_answer: 'Gợi ý' } },
      ],
      answers: [
        { attempt_id: 'at1', question_id: 'q1', selected_options: ['a'], essay_response: null },
        { attempt_id: 'at1', question_id: 'q2', selected_options: ['c', 'a'], essay_response: null },
        { attempt_id: 'at1', question_id: 'q3', selected_options: null, essay_response: 'Bài làm' },
      ],
    });
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await wb.xlsx.writeBuffer() as ArrayBuffer);

    expect(loaded.worksheets.map((w) => w.name)).toEqual(['Kết quả trắc nghiệm', 'Kết quả tự luận', 'Hồ sơ phúc khảo', 'Đáp án']);

    const mc = loaded.getWorksheet('Kết quả trắc nghiệm')!;
    const headers = (mc.getRow(1).values as unknown[]).map(String);
    expect(headers.some((h) => h.includes('Bắt đầu'))).toBe(true);
    expect(headers.some((h) => h.includes('Kết thúc'))).toBe(true);
    expect(headers.some((h) => h.includes('Thời gian làm bài'))).toBe(true);
    expect(mc.getRow(2).values).toContain('Nguyen A');

    const essay = loaded.getWorksheet('Kết quả tự luận')!;
    expect(essay.rowCount).toBe(2);
    expect(essay.getRow(2).values).toContain('Bài làm');

    const review = loaded.getWorksheet('Hồ sơ phúc khảo')!;
    expect(review.rowCount).toBe(2);
    expect((review.getRow(2).getCell(13).value as { hyperlink: string }).hyperlink).toBe('pdfs/Nguyen_A_CT1_0001.pdf');
  });
});
