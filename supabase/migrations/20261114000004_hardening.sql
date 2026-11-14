-- Защита: регистрация только через приглашение (даже если в панели забыли выключить
-- открытую регистрацию), завершение сессий при сбросе пароля, ограничение частоты
-- попыток регистрации.

-- ─────────────────────────────────────────────────────────────
-- 1. Открытая регистрация закрыта на уровне базы
-- ─────────────────────────────────────────────────────────────
-- Пользователя в Auth создаёт только функция redeem-invite. Она передаёт серверный ключ
-- rassvet_signup_key (из Vault) в метаданных; триггер сверяет его и сразу вырезает, так что
-- в базе ключ не остаётся. Публичный /auth/v1/signup ключа не знает — получит ошибку.
-- Если ключ в Vault не задан (новый проект до настройки), триггер ничего не проверяет —
-- поэтому первым шагом настройки задаётся ключ (см. README).
-- Побочный эффект: «Add user» в панели Supabase тоже не сработает — так и задумано.
create function private.guard_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_key text := private.secret('rassvet_signup_key');
begin
  if v_key is not null then
    if coalesce(new.raw_user_meta_data ->> 'rassvet_signup_key', '') <> v_key then
      raise exception 'Регистрация только по приглашению' using errcode = '42501';
    end if;
  end if;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'rassvet_signup_key';
  return new;
end $$;
revoke all on function private.guard_signup() from public, authenticated, anon;

create trigger rassvet_guard_signup before insert on auth.users
  for each row execute function private.guard_signup();

create function public.signup_key() returns text
language sql stable security definer set search_path = '' as $$
  select private.secret('rassvet_signup_key')
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. Сброс пароля завершает все сессии пользователя
-- ─────────────────────────────────────────────────────────────
-- Иначе потерянный телефон с открытым «Рассветом» остаётся в аккаунте и после сброса.
-- Удаление сессии отзывает её refresh-токены; текущий access-токен истечёт сам (≤ 1 ч).
create function public.revoke_user_sessions(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int := 0;
begin
  if to_regclass('auth.sessions') is null then return 0; end if;
  execute 'delete from auth.sessions where user_id = $1' using p_user;
  get diagnostics n = row_count;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 3. Ограничение частоты (регистрация по приглашению)
-- ─────────────────────────────────────────────────────────────
create table private.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         int not null
);

-- true — можно; false — превышен лимит p_max за окно p_window.
create function public.rate_limit_hit(p_key text, p_max int, p_window interval) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_hits int;
begin
  insert into private.rate_limits as r (key, window_start, hits)
  values (left(p_key, 200), clock_timestamp(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < clock_timestamp() - p_window then 1 else r.hits + 1 end,
        window_start = case when r.window_start < clock_timestamp() - p_window then clock_timestamp() else r.window_start end
  returning hits into v_hits;
  -- Попутно чистим старое, чтобы таблица не росла.
  delete from private.rate_limits where window_start < clock_timestamp() - interval '1 day';
  return v_hits <= p_max;
end $$;

revoke execute on function public.signup_key(), public.revoke_user_sessions(uuid),
                           public.rate_limit_hit(text, int, interval)
  from public, anon, authenticated;
grant execute on function public.signup_key(), public.revoke_user_sessions(uuid),
                          public.rate_limit_hit(text, int, interval)
  to service_role;
