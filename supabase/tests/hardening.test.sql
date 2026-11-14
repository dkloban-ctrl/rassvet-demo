-- Тесты защиты: регистрация только через приглашение, сессии, частота, секреты рассылки.
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

-- ── Регистрация в Auth ──
select lives_ok($$insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000091', 'a@example.com')$$,
  'ключ регистрации не задан (новый проект) — триггер не мешает');
insert into vault.decrypted_secrets values ('rassvet_signup_key', 'k-123'),
  ('rassvet_vapid_public', 'PUBKEY'), ('rassvet_vapid_private', '{"d":"x"}'),
  ('rassvet_vapid_subject', 'mailto:x@example.com'), ('rassvet_notify_token', 'tok');
select throws_ok($$insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000092', 'b@example.com')$$,
  '42501', null, 'открытая регистрация (без ключа) отвергается базой');
select throws_ok($$insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000093', 'c@example.com', '{"rassvet_signup_key":"угадал?"}')$$,
  '42501', null, 'неверный ключ отвергается');
select lives_ok($$insert into auth.users (id, email, raw_user_meta_data)
  values ('00000000-0000-0000-0000-000000000094', 'd@example.com', '{"rassvet_signup_key":"k-123","x":1}')$$,
  'регистрация с серверным ключом (redeem-invite) проходит');
select is((select raw_user_meta_data from auth.users where id = '00000000-0000-0000-0000-000000000094'), '{"x":1}'::jsonb,
  'ключ не сохраняется в базе');
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"rassvet_signup_key":"k-123"}'
 where id = '00000000-0000-0000-0000-000000000094';
select is((select raw_user_meta_data from auth.users where id = '00000000-0000-0000-0000-000000000094'), '{"x":1}'::jsonb,
  'и при повторной записи метаданных (так делает Auth) ключ вырезается');

-- ── Профили для проверок ниже ──
insert into public.profiles (id, display_name, role, status) values
  ('00000000-0000-0000-0000-000000000091', 'Лидер', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000000094', 'Новый', 'parent', 'pending');

select tests.login('00000000-0000-0000-0000-000000000091');
select throws_ok($$select public.signup_key()$$, '42501', null, 'браузер не может узнать ключ регистрации');
select throws_ok($$select public.revoke_user_sessions('00000000-0000-0000-0000-000000000094')$$, '42501', null,
  'браузер не может завершать чужие сессии');
select throws_ok($$select public.rate_limit_hit('x', 1, '1 minute')$$, '42501', null, 'браузер не трогает счётчики');
select is(public.push_public_key(), 'PUBKEY', 'активный пользователь получает публичный ключ VAPID');
select tests.logout();
select tests.login('00000000-0000-0000-0000-000000000094');
select is(public.push_public_key(), null, 'неактивный — не получает');
select tests.logout();

-- ── Сервер ──
insert into auth.sessions (user_id) values ('00000000-0000-0000-0000-000000000094'), ('00000000-0000-0000-0000-000000000094'),
  ('00000000-0000-0000-0000-000000000091');
select tests.as_server();
select is(public.signup_key(), 'k-123', 'сервер получает ключ регистрации');
select is((public.notify_config() ->> 'token'), 'tok', 'сервер получает настройки рассылки');
select is(public.revoke_user_sessions('00000000-0000-0000-0000-000000000094'), 2, 'сброс пароля: завершены обе сессии пользователя');
select ok(public.rate_limit_hit('redeem:1.2.3.4', 3, '15 minutes'), 'попытка 1 — можно');
select ok(public.rate_limit_hit('redeem:1.2.3.4', 3, '15 minutes'), 'попытка 2 — можно');
select ok(public.rate_limit_hit('redeem:1.2.3.4', 3, '15 minutes'), 'попытка 3 — можно');
select ok(not public.rate_limit_hit('redeem:1.2.3.4', 3, '15 minutes'), 'попытка 4 — лимит');
select ok(public.rate_limit_hit('redeem:5.6.7.8', 3, '15 minutes'), 'другой адрес считается отдельно');
select tests.logout();
select is((select count(*)::int from auth.sessions), 1, 'сессии другого пользователя не тронуты');
update private.rate_limits set window_start = now() - interval '20 minutes' where key = 'redeem:1.2.3.4';
select tests.as_server();
select ok(public.rate_limit_hit('redeem:1.2.3.4', 3, '15 minutes'), 'окно прошло — снова можно');
select tests.logout();

select * from finish();
rollback;
