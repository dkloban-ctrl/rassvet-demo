-- Минимальная имитация Supabase для локального прогона тестов на «голом» Postgres.
-- В настоящем Supabase всё это уже есть: этот файл туда НЕ применяется.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to postgres;

create schema auth;
create table auth.users (id uuid primary key, email text unique, raw_user_meta_data jsonb);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null);

-- Vault: в Supabase секреты зашифрованы; здесь — простая таблица с тем же представлением.
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
-- Как в Supabase: пустой или отсутствующий токен даёт null, а не ошибку.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Как в Supabase: на новые объекты public по умолчанию выдаются права всем трём ролям.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- pgTAP: расширением, если установлено в систему; иначе run.sh подгрузит его скриптом (PGTAP_SQL).
do $$ begin
  if exists (select from pg_available_extensions where name = 'pgtap') then create extension if not exists pgtap; end if;
end $$;
