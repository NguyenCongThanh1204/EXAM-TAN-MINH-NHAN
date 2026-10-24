-- Cách hiển thị câu hỏi cho thí sinh: paged = từng câu một, all = hiển thị tất cả câu cùng lúc.
alter table exam_settings
  add column if not exists display_mode text not null default 'paged';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exam_settings_display_mode_check') then
    alter table exam_settings
      add constraint exam_settings_display_mode_check check (display_mode in ('paged', 'all'));
  end if;
end $$;
