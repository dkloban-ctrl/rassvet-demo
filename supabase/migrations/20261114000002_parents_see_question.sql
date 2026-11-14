-- Решение 14.11: родители видят ТЕКСТ вопроса недели (повод для разговора дома).
-- Ответы подростков по-прежнему закрыты для родителей (answers_feed для родителя пуст).
drop policy questions_select on public.questions;
create policy questions_select on public.questions for select to authenticated using (
  private.is_admin()
  or (private.my_role() in ('helper', 'teen', 'parent') and published_at <= now())
);
