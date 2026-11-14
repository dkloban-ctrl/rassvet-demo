-- Тесты прав доступа MVP-1. Каждый тест = клетка матрицы из docs/permissions.md.
-- Запуск: `supabase test db` (или scripts/local-test/run.sh на голом Postgres).
begin;
select no_plan();

-- ── Вспомогательное: войти под пользователем / выйти ──
create schema tests;
create function tests.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant usage on schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;

-- ── Люди ──
-- 01 Дмитрий, 02 Сабина — админы; 03 Настя — помощник (17)
-- 04 Ольга — мама Маши (11) и Лёши (13); 05 Ирина — мама Пети (12) и Блока (14); 06 Анна — мама Насти
-- 13 Лёша — без согласия (не активен); 14 — заблокирован
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000000' || n)::uuid
  from unnest(array['01','02','03','04','05','06','11','12','13','14']) n;

insert into public.profiles (id, display_name, role, is_minor, status) values
 ('00000000-0000-0000-0000-000000000001', 'Дмитрий', 'admin',  false, 'active'),
 ('00000000-0000-0000-0000-000000000002', 'Сабина',  'admin',  false, 'active'),
 ('00000000-0000-0000-0000-000000000003', 'Настя',   'helper', true,  'pending'),
 ('00000000-0000-0000-0000-000000000004', 'Ольга',   'parent', false, 'active'),
 ('00000000-0000-0000-0000-000000000005', 'Ирина',   'parent', false, 'active'),
 ('00000000-0000-0000-0000-000000000006', 'Анна',    'parent', false, 'active'),
 ('00000000-0000-0000-0000-000000000011', 'Маша',    'teen',   true,  'pending'),
 ('00000000-0000-0000-0000-000000000012', 'Петя',    'teen',   true,  'pending'),
 ('00000000-0000-0000-0000-000000000013', 'Лёша',    'teen',   true,  'pending'),
 ('00000000-0000-0000-0000-000000000014', 'Блок',    'teen',   true,  'pending');

insert into public.family_links (parent_id, teen_id) values
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011'),
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000013'),
 ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012'),
 ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000014'),
 ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003');

insert into public.consent_documents (version, title, is_current) values ('v0.1', 'Согласие родителя', true);
insert into public.consents (teen_id, parent_id, version) values
 ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000004', 'v0.1'),
 ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000005', 'v0.1'),
 ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000005', 'v0.1'),
 ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000006', 'v0.1');
update public.profiles set status = 'active'
 where id in ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011',
              '00000000-0000-0000-0000-000000000012');
update public.profiles set status = 'blocked' where id = '00000000-0000-0000-0000-000000000014';

-- ── Содержание ──
insert into public.leaflets (id, week, title, body, published_at) values
 ('10000000-0000-0000-0000-000000000001', '2026-11-09', 'Опубликован', '...', now() - interval '1 day'),
 ('10000000-0000-0000-0000-000000000002', '2026-11-16', 'Черновик',    '...', null);
insert into public.questions (id, week, body, published_at, closes_at) values
 ('20000000-0000-0000-0000-000000000001', '2026-11-09', 'Открытый вопрос', now() - interval '1 day', null),
 ('20000000-0000-0000-0000-000000000002', '2026-11-02', 'Закрытый вопрос', now() - interval '8 day', now() - interval '1 day'),
 ('20000000-0000-0000-0000-000000000003', '2026-11-16', 'Будущий вопрос',  null, null);
insert into public.events (title, starts_at) values ('Встреча', now() + interval '2 day');

-- ════════════════════════════════════════════════════════════
-- Без входа
-- ════════════════════════════════════════════════════════════
select set_config('role', 'anon', true);
select throws_ok('select * from public.leaflets', '42501', null, 'аноним: листки недоступны');
select throws_ok('select * from public.profiles', '42501', null, 'аноним: профили недоступны');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Маша (подросток)
-- ════════════════════════════════════════════════════════════
select tests.login('00000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.leaflets), 1, 'подросток: видит только опубликованный листок');
select throws_ok($$insert into public.leaflets (week, title, body) values ('2026-12-01','x','x')$$,
  '42501', null, 'подросток: не может публиковать листок');
select is((select count(*)::int from public.questions), 2, 'подросток: видит опубликованные вопросы, не будущие');
select is((select count(*)::int from public.events), 1, 'подросток: видит расписание');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000004'), 1,
  'подросток: видит свою маму');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000005'), 0,
  'подросток: не видит чужих родителей');

select lives_ok($$insert into public.answers (id, question_id, body, is_anonymous)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Анонимный ответ Маши', true)$$,
  'подросток: отвечает анонимно на открытый вопрос');
select throws_ok($$insert into public.answers (question_id, body) values ('20000000-0000-0000-0000-000000000002', 'поздно')$$,
  '42501', null, 'подросток: не отвечает на закрытый вопрос');
select throws_ok($$insert into public.answers (question_id, body) values ('20000000-0000-0000-0000-000000000003', 'рано')$$,
  '42501', null, 'подросток: не отвечает на неопубликованный вопрос');
select lives_ok($$update public.answers set body = 'Анонимный ответ Маши (исправлен)'
  where id = '30000000-0000-0000-0000-000000000001'$$, 'подросток: правит свой ответ, пока вопрос открыт');
select throws_ok($$update public.answers set hidden_at = null where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'подросток: не может трогать поле скрытия');
select throws_ok($$update public.profiles set role = 'admin' where id = auth.uid()$$,
  '42501', null, 'подросток: не может повысить себе роль');
select throws_ok($$select public.hide_answer('30000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'подросток: не может скрывать ответы');
select is((select count(*)::int from public.audit_log), 0, 'подросток: журнал не виден');
select throws_ok($$insert into public.audit_log (action) values ('fake')$$, '42501', null,
  'подросток: не может писать в журнал');

-- Обращение к лидеру ДО того, как маме откроют доступ
select lives_ok($$insert into public.inbox_threads (id) values ('40000000-0000-0000-0000-000000000001')$$,
  'подросток: создаёт обращение к лидеру');
select lives_ok($$insert into public.inbox_messages (id, thread_id, body)
  values ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Сообщение ДО доступа')$$,
  'подросток: пишет в своё обращение');
select throws_ok($$update public.inbox_messages set body = 'переписано' where id = '41000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'подросток: сообщение лидеру нельзя переписать');
select is((select count(*)::int from public.parent_inbox_access), 0, 'подросток: пока никто из родителей не читает');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Петя (другой подросток)
-- ════════════════════════════════════════════════════════════
select tests.login('00000000-0000-0000-0000-000000000012');
select lives_ok($$insert into public.answers (id, question_id, body)
  values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Публичный ответ Пети')$$,
  'подросток: отвечает публично');
select is((select count(*)::int from public.answers), 1, 'подросток: напрямую из таблицы видит только свой ответ');
select is((select count(*)::int from public.answers_feed('20000000-0000-0000-0000-000000000001')), 2,
  'подросток: в ленте видит оба ответа');
select is((select author_id from public.answers_feed('20000000-0000-0000-0000-000000000001') where is_anonymous),
  null, 'подросток: автор анонимного ответа скрыт');
select is((select author_name from public.answers_feed('20000000-0000-0000-0000-000000000001') where is_anonymous),
  null, 'подросток: имя автора анонимного ответа скрыто');
select is((select author_name from public.answers_feed('20000000-0000-0000-0000-000000000001') where not is_anonymous),
  'Петя', 'подросток: имя у публичного ответа видно');
select is((select count(*)::int from public.inbox_threads), 0, 'подросток: не видит чужие обращения');
select is((select count(*)::int from public.inbox_messages), 0, 'подросток: не видит чужие сообщения лидеру');
select lives_ok($$insert into public.inbox_threads (id, author_id)
  values ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011')$$,
  'подросток: попытка создать обращение от чужого имени не падает…');
select is((select author_id from public.inbox_threads where id = '40000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-000000000012'::uuid, '…но автором записан он сам');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Настя (помощник, 17)
-- ════════════════════════════════════════════════════════════
select tests.login('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from public.answers_feed('20000000-0000-0000-0000-000000000001')), 2,
  'помощник: видит ленту ответов');
select is((select author_id from public.answers_feed('20000000-0000-0000-0000-000000000001') where is_anonymous),
  null, 'помощник: автор анонимного ответа скрыт и от помощника');
select is((select count(*)::int from public.answers), 0, 'помощник: напрямую ответы не читает');
select throws_ok($$insert into public.answers (question_id, body) values ('20000000-0000-0000-0000-000000000001', 'x')$$,
  '42501', null, 'помощник: не отвечает на вопрос недели');
select is((select count(*)::int from public.inbox_messages), 0, 'помощник: не видит ящик лидеров');
select is((select count(*)::int from public.audit_log), 0, 'помощник: журнал не виден');
select throws_ok($$insert into public.leaflets (week, title, body) values ('2026-12-01','x','x')$$,
  '42501', null, 'помощник: не публикует листок');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Дмитрий (админ)
-- ════════════════════════════════════════════════════════════
select tests.login('00000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.leaflets), 2, 'админ: видит и черновики');
select is((select author_id from public.answers_feed('20000000-0000-0000-0000-000000000001') where is_anonymous),
  '00000000-0000-0000-0000-000000000011'::uuid, 'админ: видит автора анонимного ответа');
select lives_ok($$insert into public.answer_replies (answer_id, body)
  values ('30000000-0000-0000-0000-000000000001', 'Спасибо за честность')$$, 'админ: отвечает на ответ');
select is((select count(*)::int from public.inbox_messages), 1, 'админ: видит ящик лидеров');
select lives_ok($$insert into public.inbox_messages (thread_id, body)
  values ('40000000-0000-0000-0000-000000000001', 'Ответ лидера')$$, 'админ: отвечает в обращении');

select throws_ok($$insert into public.parent_inbox_access (parent_id, teen_id)
  values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'админ: доступ родителю нельзя вставить напрямую (только функцией, со временем сервера)');
select throws_ok($$select public.grant_parent_inbox_access('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000011')$$,
  '23503', null, 'админ: нельзя открыть обращения ребёнка чужому родителю');
select throws_ok($$select public.admin_update_profile('00000000-0000-0000-0000-000000000013', p_status => 'active')$$,
  'P0001', null, 'админ: нельзя активировать подростка без согласия');
select throws_ok($$select public.admin_update_profile('00000000-0000-0000-0000-000000000001', p_role => 'parent')$$,
  'P0001', null, 'админ: не может разжаловать сам себя');
select lives_ok($$select public.admin_update_profile('00000000-0000-0000-0000-000000000003', p_display_name => 'Настя К.')$$,
  'админ: меняет профиль');
select ok(exists (select 1 from public.audit_log where table_name = 'profiles'
                  and row_id = '00000000-0000-0000-0000-000000000003'),
  'админ: изменение профиля попало в журнал');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Ольга (мама Маши), доступа к обращениям пока нет
-- ════════════════════════════════════════════════════════════
select tests.login('00000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.leaflets), 1, 'родитель: видит опубликованный листок');
select is((select count(*)::int from public.events), 1, 'родитель: видит расписание');
select is((select count(*)::int from public.questions), 2, 'родитель: видит текст опубликованных вопросов (решение 14.11)');
select is((select count(*)::int from public.answers_feed('20000000-0000-0000-0000-000000000001')), 0,
  'родитель: ответы подростков не видны');
select is((select count(*)::int from public.answer_replies), 0, 'родитель: ответы лидеров на ответы не видны');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000011'), 1,
  'родитель: видит своего ребёнка');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-000000000012'), 0,
  'родитель: не видит чужих детей');
select is((select count(*)::int from public.inbox_messages), 0, 'родитель: напрямую обращения ребёнка не видит');
select throws_ok($$select * from public.child_inbox('00000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'родитель: без открытого доступа обращения ребёнка закрыты');
select throws_ok($$insert into public.consents (teen_id, parent_id, version)
  values ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000004', 'v0.1')$$,
  null, 'родитель: не может подписать согласие за чужого ребёнка');
select lives_ok($$insert into public.invites (role, parent_id, created_by)
  values ('teen', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004')$$,
  'родитель: запрашивает приглашение для своего ребёнка');
select throws_ok($$insert into public.invites (role, parent_id, created_by)
  values ('admin', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'родитель: не может создать приглашение админа');
select throws_ok($$insert into public.invites (role, parent_id, created_by, approved_by)
  values ('teen', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'родитель: не может сам одобрить приглашение');
select lives_ok($$insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push/olga', 'k', 'a')$$,
  'родитель: подписывается на уведомления');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Админ открывает Ольге доступ. Маша видит это и пишет снова.
-- ════════════════════════════════════════════════════════════
select tests.login('00000000-0000-0000-0000-000000000002');
select lives_ok($$select public.grant_parent_inbox_access('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011')$$,
  'админ: открывает маме доступ к обращениям');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.parent_inbox_access where revoked_at is null), 1,
  'подросток: видит, что мама теперь читает обращения');
select is((select p.display_name from public.parent_inbox_access a join public.profiles p on p.id = a.parent_id
           where a.revoked_at is null), 'Ольга', 'подросток: видит, кто именно читает');
select lives_ok($$insert into public.inbox_messages (id, thread_id, body)
  values ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'Сообщение ПОСЛЕ доступа')$$,
  'подросток: пишет после открытия доступа');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000012');
select is((select count(*)::int from public.parent_inbox_access), 0, 'другой подросток: чужие доступы не видны');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000004');
select is((select count(*)::int from public.child_inbox('00000000-0000-0000-0000-000000000011')
           where body = 'Сообщение ДО доступа'), 0, 'родитель: сообщения ДО открытия доступа не видны');
select is((select count(*)::int from public.child_inbox('00000000-0000-0000-0000-000000000011')
           where body = 'Сообщение ПОСЛЕ доступа'), 1, 'родитель: сообщения ПОСЛЕ открытия доступа видны');
select throws_ok($$select * from public.child_inbox('00000000-0000-0000-0000-000000000013')$$,
  '42501', null, 'родитель: доступ к одному ребёнку не открывает другого');
select throws_ok($$insert into public.inbox_messages (thread_id, body) values ('40000000-0000-0000-0000-000000000001', 'мама пишет')$$,
  '42501', null, 'родитель: только чтение — писать в обращение ребёнка нельзя');
select throws_ok($$update public.parent_inbox_access set granted_at = now() - interval '1 year'$$,
  '42501', null, 'родитель: не может сдвинуть дату доступа');
select tests.logout();

select throws_ok($$update public.parent_inbox_access set granted_at = now() - interval '1 year'$$,
  'P0001', null, 'даже с полными правами дату выдачи доступа нельзя сдвинуть назад');

select tests.login('00000000-0000-0000-0000-000000000001');
select ok(exists (select 1 from public.audit_log where action = 'parent_read_inbox'
                  and actor_id = '00000000-0000-0000-0000-000000000004'),
  'админ: чтение обращений родителем записано в журнал');
select ok(exists (select 1 from public.audit_log where table_name = 'parent_inbox_access' and action = 'insert'),
  'админ: выдача доступа записана в журнал');
select lives_ok($$select public.revoke_parent_inbox_access(id) from public.parent_inbox_access where revoked_at is null$$,
  'админ: закрывает доступ');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000004');
select throws_ok($$select * from public.child_inbox('00000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'родитель: после отзыва доступа обращения снова закрыты');
-- Согласие за Лёшу и его активация
select lives_ok($$insert into public.consents (teen_id, parent_id, version)
  values ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000004', 'v0.1')$$,
  'родитель: подписывает согласие за своего ребёнка');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000013');
select is((select count(*)::int from public.leaflets), 0, 'подросток без активации: ничего не видит');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000001');
select lives_ok($$select public.admin_update_profile('00000000-0000-0000-0000-000000000013', p_status => 'active')$$,
  'админ: активирует подростка после согласия');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000004');
select lives_ok($$select public.revoke_consent(id) from public.consents where teen_id = '00000000-0000-0000-0000-000000000013'$$,
  'родитель: отзывает согласие');
select tests.logout();
select is((select status::text from public.profiles where id = '00000000-0000-0000-0000-000000000013'), 'pending',
  'после отзыва согласия подросток сразу деактивирован');

-- ════════════════════════════════════════════════════════════
-- Прочее
-- ════════════════════════════════════════════════════════════
select tests.login('00000000-0000-0000-0000-000000000014');
select is((select count(*)::int from public.leaflets), 0, 'заблокированный: ничего не видит');
select is((select count(*)::int from public.answers_feed('20000000-0000-0000-0000-000000000001')), 0,
  'заблокированный: лента ответов пуста');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000005');
select is((select count(*)::int from public.push_subscriptions), 0, 'родитель: чужие подписки на пуш не видны');
select is((select count(*)::int from public.invites), 0, 'родитель: чужие приглашения не видны');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.invites), 0, 'подросток: приглашения не видны');
select is((select count(*)::int from public.answer_replies), 1, 'подросток: видит ответ лидера на свой ответ');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000002');
select lives_ok($$select public.hide_answer('30000000-0000-0000-0000-000000000002')$$, 'админ: скрывает ответ');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.answers_feed('20000000-0000-0000-0000-000000000001')), 1,
  'подросток: скрытый ответ из ленты пропал');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000012');
select is((select count(*)::int from public.answers_feed('20000000-0000-0000-0000-000000000001') where is_mine), 1,
  'автор скрытого ответа по-прежнему видит его у себя');
select tests.logout();

select * from finish();
rollback;
