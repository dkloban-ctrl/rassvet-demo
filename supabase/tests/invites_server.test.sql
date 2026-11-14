-- Тесты серверной части регистрации по приглашению и права на сброс пароля.
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
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

-- 01 админ, 04 Ольга (мама 11 Маши), 05 Ирина (мама 12 Пети); 21–24 — будущие пользователи
insert into auth.users (id) select ('00000000-0000-0000-0000-0000000000' || n)::uuid
  from unnest(array['01','04','05','11','12','21','22','23','24']) n;
insert into public.profiles (id, display_name, role, is_minor, status) values
 ('00000000-0000-0000-0000-000000000001', 'Дмитрий', 'admin',  false, 'active'),
 ('00000000-0000-0000-0000-000000000004', 'Ольга',   'parent', false, 'active'),
 ('00000000-0000-0000-0000-000000000005', 'Ирина',   'parent', false, 'active'),
 ('00000000-0000-0000-0000-000000000011', 'Маша',    'teen',   true,  'pending'),
 ('00000000-0000-0000-0000-000000000012', 'Петя',    'teen',   true,  'pending');
insert into public.family_links values
 ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011'),
 ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000012');

-- ── Админ создаёт приглашения ──
select tests.login('00000000-0000-0000-0000-000000000001');
select lives_ok($$insert into public.invites (code, role, email) values ('PARENT1', 'parent', 'mama@example.com')$$,
  'админ: приглашение родителя по e-mail');
select is((select approved_by from public.invites where code = 'PARENT1'),
  '00000000-0000-0000-0000-000000000001'::uuid, 'админ: его приглашение одобрено автоматически');
select lives_ok($$insert into public.invites (code, role, parent_id)
  values ('TEEN1', 'teen', '00000000-0000-0000-0000-000000000004')$$, 'админ: приглашение подростка к маме');
select throws_ok($$insert into public.invites (code, role) values ('BAD1', 'teen')$$,
  '23514', null, 'подростка нельзя пригласить без родителя');
select throws_ok($$insert into public.invites (code, role, email, parent_id)
  values ('BAD2', 'teen', 'x@example.com', '00000000-0000-0000-0000-000000000004')$$,
  '23514', null, 'у приглашения подростка нет e-mail (вход по логину)');
select throws_ok($$insert into public.invites (code, role, email) values ('BAD3', 'helper', 'h@example.com')$$,
  '23514', null, 'помощника (17) нельзя пригласить без родителя');
select throws_ok($$insert into public.invites (code, role, email) values ('BAD4', 'parent', 'Mama@Example.com ')$$,
  '23514', null, 'e-mail хранится только в нижнем регистре');
select lives_ok($$insert into public.invites (code, role, email, expires_at) values ('OLD1', 'parent', 'old@example.com', now() - interval '1 day')$$,
  'админ: просроченное приглашение (для теста)');
select throws_ok($$select * from public.invite_lookup('PARENT1')$$, '42501', null,
  'браузер не может вызвать проверку приглашения');
select throws_ok($$select public.invite_complete('PARENT1', '00000000-0000-0000-0000-000000000021', 'x')$$, '42501', null,
  'браузер не может завершить регистрацию');
select throws_ok($$select public.can_reset_password('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011')$$,
  '42501', null, 'браузер не может вызвать проверку права на сброс пароля');
select tests.logout();

-- ── Родитель просит приглашение для ребёнка ──
select tests.login('00000000-0000-0000-0000-000000000004');
select lives_ok($$insert into public.invites (code, role, parent_id, created_by)
  values ('REQ1', 'teen', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004')$$,
  'родитель: запрос приглашения');
select is((select approved_by from public.invites where code = 'REQ1'), null, 'родитель: запрос не одобрен сам собой');
select throws_ok($$select public.approve_invite(id) from public.invites where code = 'REQ1'$$, '42501', null,
  'родитель: не может одобрить свой запрос');
select tests.logout();

-- ── Сервер ──
select tests.as_server();
select is((select count(*)::int from public.invite_lookup('PARENT1')), 1, 'сервер: действующее приглашение найдено');
select is((select count(*)::int from public.invite_lookup('REQ1')), 0, 'сервер: неодобренное приглашение не действует');
select is((select count(*)::int from public.invite_lookup('OLD1')), 0, 'сервер: просроченное приглашение не действует');
select is((select count(*)::int from public.invite_lookup('NOPE')), 0, 'сервер: несуществующий код');
select throws_ok($$select public.invite_complete('REQ1', '00000000-0000-0000-0000-000000000023', 'Лёша')$$,
  'P0002', null, 'сервер: неодобренное приглашение нельзя использовать');

select is(public.invite_complete('PARENT1', '00000000-0000-0000-0000-000000000021', '  Мама Вера '),
  'parent'::public.user_role, 'сервер: родитель зарегистрирован');
select tests.logout();
select is((select status::text || '|' || display_name from public.profiles where id = '00000000-0000-0000-0000-000000000021'),
  'active|Мама Вера', 'родитель по приглашению админа активен сразу, имя без лишних пробелов');
select tests.as_server();
select throws_ok($$select public.invite_complete('PARENT1', '00000000-0000-0000-0000-000000000022', 'Второй')$$,
  'P0002', null, 'сервер: приглашение одноразовое');
select is(public.invite_complete('TEEN1', '00000000-0000-0000-0000-000000000022', 'Даша'),
  'teen'::public.user_role, 'сервер: подросток зарегистрирован');
select tests.logout();
select is((select status::text || '|' || is_minor::text from public.profiles where id = '00000000-0000-0000-0000-000000000022'),
  'pending|true', 'подросток после регистрации не активен до согласия');
select ok(exists (select 1 from public.family_links where parent_id = '00000000-0000-0000-0000-000000000004'
                  and teen_id = '00000000-0000-0000-0000-000000000022'), 'подросток сразу привязан к маме');
select ok(exists (select 1 from public.audit_log where table_name = 'invites' and action = 'update'),
  'использование приглашения записано в журнал');

-- ── Админ одобряет запрос родителя ──
select tests.login('00000000-0000-0000-0000-000000000001');
select lives_ok($$select public.approve_invite(id) from public.invites where code = 'REQ1'$$, 'админ: одобряет запрос');
select tests.as_server();
select is((select count(*)::int from public.invite_lookup('REQ1')), 1, 'после одобрения приглашение действует');

-- ── Кто может сбросить пароль ──
select ok(public.can_reset_password('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011'),
  'админ может сбросить пароль подростку');
select ok(public.can_reset_password('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011'),
  'мама может сбросить пароль своему ребёнку');
select ok(not public.can_reset_password('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000012'),
  'мама не может сбросить пароль чужому ребёнку');
select ok(not public.can_reset_password('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001'),
  'никто не сбрасывает так пароль взрослому');
select ok(not public.can_reset_password('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012'),
  'подросток не сбрасывает пароль другому');
select tests.logout();
update public.profiles set status = 'blocked' where id = '00000000-0000-0000-0000-000000000004';
select tests.as_server();
select ok(not public.can_reset_password('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000011'),
  'заблокированный родитель пароль не сбрасывает');
select tests.logout();

select * from finish();
rollback;
