import { describe, expect, it } from 'vitest';
import { buildReviewPdf, fontSubsetForCharacter, reviewPdfName } from './review-pdf.js';

describe('buildReviewPdf', () => {
  it('selects all Tinos subsets needed for Vietnamese text', () => {
    expect(fontSubsetForCharacter('ê')).toBe('latin');
    expect(fontSubsetForCharacter('â')).toBe('latin');
    expect(fontSubsetForCharacter('ô')).toBe('latin');
    expect(fontSubsetForCharacter('ấ')).toBe('vietnamese');
    expect(fontSubsetForCharacter('ạ')).toBe('vietnamese');
    expect(fontSubsetForCharacter('á')).toBe('latin');
  });

  it('names PDFs with candidate and main project', () => {
    expect(reviewPdfName({
      id: 'attempt-1', full_name: 'Nguyễn Văn A', normalized_email: 'a@example.com', position: 'Kỹ sư',
      candidate_level: 'Cấp 1', main_project: 'Công trình chính', question_order: [],
      correct_count: 0, incorrect_count: 0, scored_points: 0, total_points: 0, result: null,
      started_at: '2026-01-01T01:00:00Z', submitted_at: '2026-01-01T01:30:00Z',
    }, 0)).toBe('Nguyen_Van_A_Cong_trinh_chinh_0001.pdf');
  });

  it('creates a Vietnamese appeal PDF with the candidate submission', async () => {
    const pdf = await buildReviewPdf({
      attempt: {
        id: 'attempt-1', full_name: 'Nguyễn Văn A', normalized_email: 'a@example.com', position: 'Kỹ sư',
        candidate_level: 'Cấp 1', main_project: 'Công trình chính', question_order: ['q1', 'q2'],
        correct_count: 1, incorrect_count: 0, scored_points: 1, total_points: 1, result: 'PASS',
        started_at: '2026-01-01T01:00:00Z', submitted_at: '2026-01-01T01:30:00Z',
      },
      questions: [
        { id: 'q1', question_text: 'Thủ đô của Việt Nam? Thử nghiệm ê â ô.', options: [{ id: 'a', text: 'Hà Nội' }, { id: 'b', text: 'Huế' }], question_type: 'single', points: 1, question_keys: { correct_options: ['a'], reference_answer: null } },
        { id: 'q2', question_text: 'Trình bày phương án.', options: null, question_type: 'essay', points: 5, question_keys: { correct_options: [], reference_answer: 'Đáp án tham khảo' } },
      ],
      answers: [
        { attempt_id: 'attempt-1', question_id: 'q1', selected_options: ['a'], essay_response: null },
        { attempt_id: 'attempt-1', question_id: 'q2', selected_options: null, essay_response: 'Bài làm của thí sinh' },
      ],
    });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.includes(Buffer.from('Tinos'))).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
