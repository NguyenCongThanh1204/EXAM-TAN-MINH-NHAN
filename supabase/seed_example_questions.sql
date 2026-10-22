-- EXAMPLE ONLY: 50 placeholder questions, correct answer always "a". Replace with real questions before the exam.
with q as (
  insert into exam_questions(question_text, options)
  select 'Câu hỏi mẫu ' || g, '[{"id":"a","text":"Đáp án A"},{"id":"b","text":"Đáp án B"},{"id":"c","text":"Đáp án C"},{"id":"d","text":"Đáp án D"}]'::jsonb
  from generate_series(1, 50) g returning id)
insert into question_keys(question_id, correct_option) select id, 'a' from q;
