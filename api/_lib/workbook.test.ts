import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildResultsWorkbook, orderExportAttempts } from './workbook.js';

const options = [{ id: 'a', text: 'Một' }, { id: 'b', text: 'Hai' }, { id: 'c', text: 'Ba' }];

describe('buildResultsWorkbook', () => {
  it('orders attempts by the imported participant sequence', () => {
    const attempt = {
      full_name: 'Candidate', normalized_email: 'candidate@x.com', position: 'KS', candidate_level: 'Cấp 1',
      main_project: 'CT1', question_order: [], correct_count: 0, incorrect_count: 0,
      scored_points: 0, total_points: 0, result: null, started_at: '2026-01-01T01:00:00Z',
      submitted_at: '2026-01-01T01:30:00Z',
    };
    const ordered = orderExportAttempts([
      { ...attempt, id: 'later', participant_order: 9 },
      { ...attempt, id: 'earlier', participant_order: 2 },
    ]);

    expect(ordered.map((item) => item.id)).toEqual(['earlier', 'later']);
  });

  it('exports workbook rows and PDF links using the imported sequence', () => {
    const attempt = {
      full_name: 'Candidate', normalized_email: 'candidate@x.com', position: 'KS', candidate_level: 'Cấp 1',
      main_project: 'CT1', question_order: [], correct_count: 0, incorrect_count: 0,
      scored_points: 0, total_points: 0, result: null, started_at: '2026-01-01T01:00:00Z',
      submitted_at: '2026-01-01T01:30:00Z',
    };
    const wb = buildResultsWorkbook({
      attempts: [
        { ...attempt, id: 'later', full_name: 'Later Candidate', participant_order: 9 },
        {
          ...attempt, id: 'earlier', full_name: 'Earlier Candidate',
          participant_order: 2, participant_list_name: 'Tên trong Excel',
        },
      ],
      questions: [],
      answers: [],
    });

    expect(wb.getWorksheet('Kết quả tổng kết')!.getRow(2).getCell(1).value).toBe(2);
    expect(wb.getWorksheet('Kết quả')!.getRow(2).getCell(1).value).toBe(2);
    expect(wb.getWorksheet('Kết quả tổng kết')!.getRow(3).getCell(1).value).toBe(9);
    expect(wb.getWorksheet('Kết quả tổng kết')!.getRow(2).getCell(3).value).toBe('Earlier Candidate');
    expect(wb.getWorksheet('Hồ sơ phúc khảo')!.getRow(2).getCell(13).value)
      .toMatchObject({ hyperlink: 'pdfs/0002_Ten_trong_Excel.pdf' });
  });

  it('does not invent a new participant sequence when the list order is missing', () => {
    expect(() => buildResultsWorkbook({
      attempts: [{
        id: 'legacy', full_name: 'Candidate', normalized_email: 'candidate@x.com', position: 'KS',
        candidate_level: 'Cấp 1', main_project: 'CT1', question_order: [], correct_count: 0,
        incorrect_count: 0, scored_points: 0, total_points: 10, result: 'FAIL',
        started_at: '2026-01-01T01:00:00Z', submitted_at: '2026-01-01T01:30:00Z',
      }],
      questions: [],
      answers: [],
    })).toThrow('Không có STT danh sách email');
  });

  it('creates a first-sheet summary and only notes tab-switch violations', () => {
    const attempt = {
      normalized_email: 'candidate@x.com', position: 'Kỹ sư', candidate_level: 'Cấp 1',
      main_project: 'Công trình A', question_order: ['mc', 'essay'], incorrect_count: 0,
      total_points: 10, started_at: '2026-01-01T01:00:00Z', submitted_at: '2026-01-01T01:30:00Z',
    };
    const wb = buildResultsWorkbook({
      attempts: [
        {
          ...attempt, id: 'normal', full_name: 'Nguyen A', participant_order: 1,
          correct_count: 1, scored_points: 1, result: 'PASS', submit_reason: 'manual',
        },
        {
          ...attempt, id: 'violation', full_name: 'Nguyen B', participant_order: 2,
          correct_count: 0, scored_points: 0, result: 'FAIL', submit_reason: 'tab_switch',
        },
      ],
      questions: [
        { id: 'mc', question_text: 'MC', options, question_type: 'single', points: 1 },
        { id: 'essay', question_text: 'Essay', options: null, question_type: 'essay', points: 0.5 },
      ],
      answers: [
        { attempt_id: 'normal', question_id: 'essay', selected_options: null, essay_response: 'Bài làm', essay_passed: true },
        { attempt_id: 'violation', question_id: 'essay', selected_options: null, essay_response: 'Bài làm', essay_passed: false },
      ],
    });

    expect(wb.worksheets[0].name).toBe('Kết quả');
    const result = wb.getWorksheet('Kết quả')!;
    expect((result.getRow(1).values as unknown[]).slice(1)).toEqual([
      'STT', 'HỌ VÀ TÊN', 'CẤP BẬC', 'CHỨC DANH', 'ĐỊA ĐIỂM THI', 'TRẮC NGHIỆM',
      'TỰ LUẬN', 'TỔNG ĐIỂM', 'THỜI GIAN LÀM BÀI', 'XẾP LOẠI', 'GHI CHÚ',
    ]);
    expect((result.getRow(2).values as unknown[]).slice(1, 9)).toEqual([
      1, 'Nguyen A', 'Cấp 1', 'Kỹ sư', 'Công trình A', 0.5, 0.5, 1,
    ]);
    expect(result.getRow(2).getCell(9).value as number).toBeCloseTo(1 / 48, 6);
    expect(result.getRow(2).getCell(10).value).toBe('ĐẠT');
    expect(result.getRow(2).getCell(11).value).toBe('');
    expect(result.getRow(3).getCell(10).value).toBe('KHÔNG ĐẠT');
    expect(result.getRow(3).getCell(11).value).toBe('Vi phạm quy chế thi: chuyển tab');
  });

  it('tách sheet trắc nghiệm và tự luận, có thời gian làm bài', async () => {
    const wb = buildResultsWorkbook({
      attempts: [{
        id: 'at1', full_name: 'Nguyen A', normalized_email: 'a@x.com', position: 'KS', candidate_level: 'Cấp 1',
        main_project: 'CT1', question_order: ['q1', 'q2', 'q3'], correct_count: 2, incorrect_count: 0,
        scored_points: 7, total_points: 10, result: 'PASS',
        started_at: '2026-01-01T01:00:00Z', submitted_at: '2026-01-01T01:30:00Z',
        participant_order: 7, participant_list_name: 'Tên trong mẫu',
      }],
      questions: [
        { id: 'q1', question_text: 'Q1', options, question_type: 'single', points: 1, question_keys: { correct_options: ['a'], reference_answer: null } },
        { id: 'q2', question_text: 'Q2', options, question_type: 'multiple', points: 1, question_keys: [{ correct_options: ['a', 'c'], reference_answer: null }] },
        { id: 'q3', question_text: 'Q3', options: null, question_type: 'essay', points: 5, question_keys: { correct_options: [], reference_answer: 'Gợi ý' } },
      ],
      answers: [
        { attempt_id: 'at1', question_id: 'q1', selected_options: ['a'], essay_response: null },
        { attempt_id: 'at1', question_id: 'q2', selected_options: ['c', 'a'], essay_response: null },
        { attempt_id: 'at1', question_id: 'q3', selected_options: null, essay_response: 'Bài làm', essay_passed: true },
      ],
    });
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await wb.xlsx.writeBuffer() as ArrayBuffer);

    expect(loaded.worksheets.map((w) => w.name)).toEqual(['Kết quả', 'Kết quả tổng kết', 'Kết quả tự luận', 'Hồ sơ phúc khảo', 'Đáp án']);

    const mc = loaded.getWorksheet('Kết quả tổng kết')!;
    const headers = (mc.getRow(1).values as unknown[]).map(String);
    expect(headers.some((h) => h.includes('Bắt đầu'))).toBe(true);
    expect(headers.some((h) => h.includes('Kết thúc'))).toBe(true);
    expect(headers.some((h) => h.includes('Thời gian làm bài'))).toBe(true);
    expect(headers.some((h) => h.includes('thang 10'))).toBe(true);
    expect(mc.getRow(2).values).toContain('Nguyen A');
    expect(mc.getRow(2).getCell(1).value).toBe(7);
    expect(mc.getRow(2).getCell(14).value).toBe(7);
    expect(mc.getRow(2).getCell(15).value).toBe(10);
    expect(mc.getRow(2).getCell(16).value).toBe(1);
    expect(mc.getRow(2).getCell(18).value).toBe('ĐẠT');

    const essay = loaded.getWorksheet('Kết quả tự luận')!;
    expect(essay.rowCount).toBe(2);
    expect(essay.getRow(2).values).toContain('Bài làm');
    expect(essay.getRow(2).getCell(15).value).toBe('ĐẠT');
    expect(essay.getRow(2).getCell(16).value).toMatchObject({ result: 0.5 });

    const review = loaded.getWorksheet('Hồ sơ phúc khảo')!;
    expect(review.rowCount).toBe(2);
    expect(review.getRow(2).getCell(1).value).toBe(7);
    expect(review.getRow(2).getCell(11).value).toBe(7);
    expect((review.getRow(2).getCell(13).value as { hyperlink: string }).hyperlink).toBe('pdfs/0007_Ten_trong_mau.pdf');
  });
});
