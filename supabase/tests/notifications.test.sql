-- Тесты уведомлений: подписки, очередь, кому что приходит, настройки, права.
begin;
select no_plan();

create schema tests;
create function tests.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function tests.as_server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;
create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Получатели как отсортированный список имён — удобно сравнивать.
create function tests.who(p_kind text, p_ref uuid) returns text language sql security definer as $$
  select coalesce(string_agg(p.display_name, ',' order by p.display_name), '')
    from public.notify_recipients(p_kind, p_ref) r join public.profiles p on p.id = r.user_id
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

-- 01 Дмитрий, 02 Сабина — админы; 03 Настя — помощник (17); 04 Ольга — мама Маши, Лёши, Насти;
-- 05 Ирина — мама Пети, заблокирована; 11 Маша, 13 Лёша — активны; 12 Петя — без согласия.
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000000001', 'dmitry@example.com'),
 ('00000000-0000-0000-0000-000000000002', 'sabina@example.com'),
 ('00000000-0000-0000-0000-000000000003', 'nastya@example.com'),
 ('00000000-0000-0000-0000-000000000004', 'olga@example.com'),
 ('00000000-0000-0000-0000-000000000005', 'irina@example.com'),
 ('00000000-0000-0000-0000-000000000011', 'masha@rassvet.internal'),
 ('00000000-0000-0000-0000-000000000012', 'petya@rassvet.internal'),
 ('00000000-0000-0000-0000-000000000013', 'lesha@rassvet.internal');
insert into public.profiles (id, display_name, role, is_minor, status) values
 ('00000000-0000-0000-0000-000000000001', 'Дмитрий', 'admin',  false, 'active'),
 ('00000000-0000-0000-0000-000000000002', 'Сабина',  'admin',  false, 'active'),
 ('00000000-0000-0000-0000-000000000003', 'Настя',   'helper', true,  'pending'),
 ('00000000-0000-0000-0000-000000000004', 'Ольга',   'parent', false, 'active'),
 ('00000000-0000-0000-0000-000000000005', 'Ирина',   'parent', false, 'blocked'),
 ('00000000-0000-0000-0000-000000000011', 'Маша',    'teen',   true,  'pending'),
 ('00000000-0000-0000-0000-000000000012', 'Петя',    'teen',   true,  'pending'),
 ('00000000-0000-0000-0000-000000000013', 'Лёша',    'teen',   true,  'pending');
insert into public.family_links (parent_id, teen_id) values
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003'),
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011'),
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000013'),
 ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012');
insert into public.consent_documents (version, title, is_current) values ('v1', 'Согласие', true);
insert into public.consents (teen_id, parent_id, version)
  select teen_id, parent_id, 'v1' from public.family_links where parent_id = '00000000-0000-0000-0000-000000000004';
update public.profiles set status = 'active'
 where id in ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013');

-- У каждого по устройству.
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, 'https://fcm.googleapis.com/fcm/send/' || display_name, repeat('A', 87), repeat('B', 22)
    from public.profiles;
insert into public.notification_prefs (user_id, question) values ('00000000-0000-0000-0000-000000000013', false);

-- ════════════════════════════════════════════════════════════
-- Подписка устройства
select tests.login('00000000-0000-0000-0000-000000000011');
select throws_ok($$select public.push_subscribe('https://evil.example.com/steal', repeat('A', 87), repeat('B', 22))$$,
  '22023', null, 'подписка на произвольный адрес отвергается (сервер не будет туда стучаться)');
select throws_ok($$select public.push_subscribe('https://fcm.googleapis.com.evil.com/x', repeat('A', 87), repeat('B', 22))$$,
  '22023', null, 'поддельный домен «похожий на Google» отвергается');
select throws_ok($$select public.push_subscribe('http://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22))$$,
  '22023', null, 'только https');
select throws_ok($$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/x', 'short', repeat('B', 22))$$,
  '22023', null, 'неверные ключи подписки отвергаются');
select lives_ok($$select public.push_subscribe('https://web.push.apple.com/QWERTY', repeat('A', 87), repeat('B', 22), 'iPhone')$$,
  'подросток: подписывает айфон (push.apple.com)');
select is((select count(*)::int from public.push_subscriptions), 2, 'подросток видит только свои подписки');
select throws_ok($$update public.push_subscriptions set user_id = '00000000-0000-0000-0000-000000000013'$$,
  '42501', null, 'подписку нельзя переписать на другого');
select tests.logout();

-- Общий телефон: мама входит на том же устройстве — подписка переходит к ней.
select tests.login('00000000-0000-0000-0000-000000000004');
select lives_ok($$select public.push_subscribe('https://web.push.apple.com/QWERTY', repeat('C', 87), repeat('D', 22))$$,
  'родитель: подписывает то же устройство');
select tests.logout();
select is((select user_id from public.push_subscriptions where endpoint = 'https://web.push.apple.com/QWERTY'),
  '00000000-0000-0000-0000-000000000004'::uuid, 'устройство теперь принадлежит маме, пуши Маши туда не идут');
delete from public.push_subscriptions where endpoint = 'https://web.push.apple.com/QWERTY';

select tests.login('00000000-0000-0000-0000-000000000012');
select throws_ok($$select public.push_subscribe('https://fcm.googleapis.com/fcm/send/p2', repeat('A', 87), repeat('B', 22))$$,
  '42501', null, 'ребёнок без согласия подписаться не может');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Публикация → очередь
select tests.login('00000000-0000-0000-0000-000000000001');
insert into public.leaflets (id, week, title, body) values
  ('30000000-0000-0000-0000-000000000001', '2026-11-16', 'Черновик', 'текст');
select is((select count(*)::int from public.notification_outbox), 0, 'черновик листка — уведомления нет');
update public.leaflets set published_at = now() where id = '30000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.notification_outbox where kind = 'leaflet'), 1, 'публикация листка — задание в очереди');
select ok((select published_at <= clock_timestamp() from public.leaflets where id = '30000000-0000-0000-0000-000000000001'),
  'время публикации не позже серверного');
insert into public.announcements (id, title, body, published_at) values
  ('32000000-0000-0000-0000-000000000009', 'Часы спешат', 'x', now() + interval '5 minutes');
select ok((select published_at <= clock_timestamp() from public.announcements where id = '32000000-0000-0000-0000-000000000009'),
  'телефон лидера спешит на 5 минут — объявление всё равно видно сразу');
select tests.logout();
delete from public.announcements where id = '32000000-0000-0000-0000-000000000009';
delete from public.notification_outbox where ref_id = '32000000-0000-0000-0000-000000000009';
select tests.login('00000000-0000-0000-0000-000000000001');
update public.leaflets set published_at = now() - interval '1 minute' where id = '30000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.notification_outbox where kind = 'leaflet'), 1, 'правка даты публикации не дублирует уведомление');
insert into public.leaflets (id, week, title, body, published_at) values
  ('30000000-0000-0000-0000-000000000002', '2026-11-23', 'Будущий', 'текст', now() + interval '3 days');
select ok((select due_at > now() + interval '2 days' from public.notification_outbox where ref_id = '30000000-0000-0000-0000-000000000002'),
  'отложенная публикация — уведомление в момент публикации');
insert into public.leaflets (id, week, title, body, published_at) values
  ('30000000-0000-0000-0000-000000000003', '2026-11-30', 'Передумали', 'текст', now());
update public.leaflets set published_at = null where id = '30000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.notification_outbox where ref_id = '30000000-0000-0000-0000-000000000003'), 0,
  'сняли с публикации до отправки — задание убрано');
insert into public.questions (id, week, body, published_at) values
  ('31000000-0000-0000-0000-000000000001', '2026-11-16', 'Что для тебя значит доверие?', now());
insert into public.announcements (id, title, body, published_at) values
  ('32000000-0000-0000-0000-000000000001', 'Поездка', 'В субботу едем', now());
select is((select count(*)::int from public.notification_outbox), 4, 'вопрос и объявление тоже в очереди');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.notification_outbox), 0, 'подросток очередь не видит');
select throws_ok($$select * from public.notify_recipients('leaflet', '30000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'браузер не может узнать список получателей');
select throws_ok($$select * from public.notify_claim(10)$$, '42501', null, 'браузер не может разбирать очередь');
select throws_ok($$select public.notify_config()$$, '42501', null, 'браузер не может прочитать ключи рассылки');
select throws_ok($$select * from public.notify_parent_emails('30000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'браузер не может получить адреса родителей');
select throws_ok($$insert into public.notification_outbox (kind, ref_id) values ('leaflet', gen_random_uuid())$$,
  '42501', null, 'подросток не может сам создать рассылку');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Кому что приходит
select tests.as_server();
select is(tests.who('leaflet', '30000000-0000-0000-0000-000000000001'), 'Лёша,Маша,Настя,Ольга',
  'листок: ребята, помощник, активный родитель; не лидеры, не заблокированная Ирина, не Петя без согласия');
select is(tests.who('leaflet', '30000000-0000-0000-0000-000000000002'), '',
  'листок с будущей датой: пока никому');
select is(tests.who('question', '31000000-0000-0000-0000-000000000001'), 'Маша,Настя',
  'вопрос: ребята и помощник; Лёша отключил вопросы; родителям пуш о вопросе не идёт');
select is(tests.who('announcement', '32000000-0000-0000-0000-000000000001'), 'Лёша,Маша,Настя,Ольга',
  'объявление: все, кроме лидеров');

select is((select count(*)::int from public.notify_claim(10)), 3, 'сервер берёт в работу только наступившие задания');
select is((select count(*)::int from public.notify_claim(10)), 0, 'взятые задания второй раз сразу не выдаются');
select lives_ok($$select public.notify_finish(id, true, 4, 0, 1) from public.notification_outbox where ref_id = '30000000-0000-0000-0000-000000000001'$$,
  'сервер отмечает отправку');
select ok((select sent_at is not null and push_sent = 4 from public.notification_outbox where ref_id = '30000000-0000-0000-0000-000000000001'),
  'в очереди видно: отправлено, сколько');

select is((select string_agg(display_name, ',' order by display_name) from public.notify_parent_emails('30000000-0000-0000-0000-000000000001')),
  'Ольга', 'письмо о листке: только активным родителям');
select tests.logout();

select tests.login('00000000-0000-0000-0000-000000000004');
select lives_ok($$insert into public.notification_prefs (email_leaflet) values (false)$$, 'родитель отключает письма');
select throws_ok($$insert into public.notification_prefs (user_id) values ('00000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'родитель не может менять настройки ребёнка');
select tests.logout();
select tests.as_server();
select is((select count(*)::int from public.notify_parent_emails('30000000-0000-0000-0000-000000000001')), 0,
  'отключил — письма не идут');
select tests.logout();

-- ════════════════════════════════════════════════════════════
-- Ящик лидеров
select tests.login('00000000-0000-0000-0000-000000000011');
insert into public.inbox_threads (id) values ('33000000-0000-0000-0000-000000000001');
insert into public.inbox_messages (id, thread_id, body) values
  ('34000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', 'Можно поговорить?');
select tests.logout();
select tests.login('00000000-0000-0000-0000-000000000001');
insert into public.inbox_messages (id, thread_id, body) values
  ('34000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000001', 'Конечно, после встречи');
select tests.logout();

select is((select kind from public.notification_outbox where ref_id = '34000000-0000-0000-0000-000000000001'), 'inbox_new',
  'сообщение подростка — задание «лидерам»');
select is((select kind from public.notification_outbox where ref_id = '34000000-0000-0000-0000-000000000002'), 'inbox_reply',
  'ответ лидера — задание «автору»');
select tests.as_server();
select is(tests.who('inbox_new', '34000000-0000-0000-0000-000000000001'), 'Дмитрий,Сабина',
  'новое обращение: всем лидерам и никому больше');
select is(tests.who('inbox_reply', '34000000-0000-0000-0000-000000000002'), 'Маша',
  'ответ лидера: только автору обращения (не маме, не другим ребятам)');
select tests.logout();

-- Блокировка сразу выключает уведомления.
update public.profiles set status = 'blocked' where id = '00000000-0000-0000-0000-000000000011';
select tests.as_server();
select is(tests.who('inbox_reply', '34000000-0000-0000-0000-000000000002'), '', 'заблокированному уведомления не идут');
select tests.logout();

select * from finish();
rollback;
