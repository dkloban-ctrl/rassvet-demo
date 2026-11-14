-- Уведомления: пуш (Web Push) и письма родителям.
--
-- Как работает:
--   1) Публикация листка/вопроса/объявления или новое сообщение в ящике кладёт задание
--      в очередь notification_outbox (триггеры ниже). Отложенная публикация — задание
--      с due_at в будущем.
--   2) Очередь разбирает серверная функция send-notifications. Её будят: сразу — триггер
--      на очереди (pg_net), и раз в 5 минут — pg_cron (отложенные и повторы после сбоев).
--   3) Кому слать, решает база (notify_recipients) по тем же ролям и статусам, что и RLS.
--
-- Приватность: в тексте пуша нет ни имён, ни текстов сообщений из ящика — экран
-- блокировки телефона могут увидеть другие. Только «новое сообщение», «лидеры ответили».
-- Подписку на чужое устройство создать нельзя, адрес push-сервиса проверяется (защита
-- серверной функции от запросов на произвольные адреса).

-- ─────────────────────────────────────────────────────────────
-- Подписки устройств
-- ─────────────────────────────────────────────────────────────
alter table public.push_subscriptions
  add column user_agent text check (char_length(user_agent) <= 300),
  add column last_ok_at timestamptz,
  add column failures   int not null default 0;

-- Только настоящие push-сервисы браузеров: сервер будет слать POST на этот адрес.
create function private.is_push_endpoint(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p ~ '^https://[a-z0-9.-]+(:443)?/' and char_length(p) <= 1000
     and substring(p from '^https://([a-z0-9.-]+)') ~ (
       '(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com'
       || '|push\.apple\.com|notify\.windows\.com)$')
$$;

drop policy push_own on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_own_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
revoke insert, update on public.push_subscriptions from authenticated;
alter table public.push_subscriptions add constraint push_endpoint_valid check (private.is_push_endpoint(endpoint));

-- Подписать это устройство на текущего пользователя. Если устройство раньше было
-- подписано на другого (общий телефон в семье), подписка переходит к новому.
create function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.my_role() is null then raise exception 'Нет прав' using errcode = '42501'; end if;
  if not private.is_push_endpoint(p_endpoint) then raise exception 'Неизвестный push-сервис' using errcode = '22023'; end if;
  if p_p256dh !~ '^[A-Za-z0-9_-]{86,88}$' or p_auth !~ '^[A-Za-z0-9_-]{21,24}$' then
    raise exception 'Неверные ключи подписки' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failures = 0, created_at = now();
end $$;

-- ─────────────────────────────────────────────────────────────
-- Настройки: что присылать. Нет строки — всё включено.
-- ─────────────────────────────────────────────────────────────
create table public.notification_prefs (
  user_id       uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  leaflet       boolean not null default true,
  question      boolean not null default true,
  announcement  boolean not null default true,
  inbox         boolean not null default true,
  email_leaflet boolean not null default true,  -- письмо родителю о новом листке
  updated_at    timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and private.my_role() is not null);
revoke all on public.notification_prefs from anon;

-- ─────────────────────────────────────────────────────────────
-- Очередь
-- ─────────────────────────────────────────────────────────────
create table public.notification_outbox (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('leaflet', 'question', 'announcement', 'inbox_new', 'inbox_reply')),
  ref_id      uuid not null,
  due_at      timestamptz not null default clock_timestamp(),
  created_at  timestamptz not null default clock_timestamp(),
  claimed_at  timestamptz,
  attempts    int not null default 0,
  sent_at     timestamptz,
  push_sent   int,
  push_failed int,
  emails_sent int,
  note        text
);
-- О каждом листке, вопросе, объявлении — одно уведомление, даже если его правили и перевыпускали.
create unique index notification_outbox_once on public.notification_outbox (kind, ref_id)
  where kind in ('leaflet', 'question', 'announcement');
create index notification_outbox_pending on public.notification_outbox (due_at) where sent_at is null;

alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;
create policy notification_outbox_admin_select on public.notification_outbox for select to authenticated
  using (private.is_admin());

-- Экран присылает «сейчас» по часам телефона. Если они спешат, листок «пропадал» бы
-- на минуты, а уведомление приходило бы раньше листка. Время чуть впереди сервера
-- заменяем серверным; дальше 15 минут — это осознанная отложенная публикация.
create function private.server_publish_time() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null)
     and new.published_at > clock_timestamp()
     and new.published_at < clock_timestamp() + interval '15 minutes' then
    new.published_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger leaflets_publish_time before insert or update of published_at on public.leaflets
  for each row execute function private.server_publish_time();
create trigger questions_publish_time before insert or update of published_at on public.questions
  for each row execute function private.server_publish_time();
create trigger announcements_publish_time before insert or update of published_at on public.announcements
  for each row execute function private.server_publish_time();

-- Публикация → задание. Снятие с публикации до отправки → задание убирается.
create function private.enqueue_publication() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_kind text := case tg_table_name when 'leaflets' then 'leaflet'
                                          when 'questions' then 'question'
                                          else 'announcement' end;
begin
  if new.published_at is null then
    delete from public.notification_outbox
     where kind = v_kind and ref_id = new.id and sent_at is null;
  elsif tg_op = 'INSERT' or new.published_at is distinct from old.published_at then
    insert into public.notification_outbox (kind, ref_id, due_at)
    values (v_kind, new.id, greatest(new.published_at, clock_timestamp()))
    on conflict (kind, ref_id) where kind in ('leaflet', 'question', 'announcement')
    do update set due_at = excluded.due_at, attempts = 0, claimed_at = null
       where public.notification_outbox.sent_at is null;
  end if;
  return new;
end $$;

create trigger leaflets_notify after insert or update of published_at on public.leaflets
  for each row execute function private.enqueue_publication();
create trigger questions_notify after insert or update of published_at on public.questions
  for each row execute function private.enqueue_publication();
create trigger announcements_notify after insert or update of published_at on public.announcements
  for each row execute function private.enqueue_publication();

-- Сообщение в ящике: от подростка/родителя → лидерам; от лидера → автору обращения.
create function private.enqueue_inbox() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_outbox (kind, ref_id)
  values (case when exists (select 1 from public.profiles p where p.id = new.author_id and p.role = 'admin')
               then 'inbox_reply' else 'inbox_new' end, new.id);
  return new;
end $$;
create trigger inbox_messages_notify after insert on public.inbox_messages
  for each row execute function private.enqueue_inbox();

-- ─────────────────────────────────────────────────────────────
-- Кому слать — решает база
-- ─────────────────────────────────────────────────────────────
-- Только активные пользователи (заблокированный или ребёнок без согласия — нет),
-- только то, что они и так могут прочитать, с учётом их настроек.
create function public.notify_recipients(p_kind text, p_ref uuid)
returns table (user_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = '' as $$
  with target as (
    select p.id
      from public.profiles p
      left join public.notification_prefs np on np.user_id = p.id
     where p.status = 'active'
       and (
         (p_kind = 'leaflet' and p.role in ('teen', 'helper', 'parent') and coalesce(np.leaflet, true)
          and exists (select 1 from public.leaflets l where l.id = p_ref and l.published_at <= clock_timestamp()))
      or (p_kind = 'question' and p.role in ('teen', 'helper') and coalesce(np.question, true)
          and exists (select 1 from public.questions q where q.id = p_ref and q.published_at <= clock_timestamp()
                       and (q.closes_at is null or q.closes_at > clock_timestamp())))
      or (p_kind = 'announcement' and p.role in ('teen', 'helper', 'parent') and coalesce(np.announcement, true)
          and exists (select 1 from public.announcements a where a.id = p_ref and a.published_at <= clock_timestamp()))
      or (p_kind = 'inbox_new' and p.role = 'admin' and coalesce(np.inbox, true)
          and exists (select 1 from public.inbox_messages m
                       where m.id = p_ref and m.author_id is distinct from p.id))
      or (p_kind = 'inbox_reply' and coalesce(np.inbox, true)
          and exists (select 1 from public.inbox_messages m join public.inbox_threads t on t.id = m.thread_id
                       where m.id = p_ref and t.author_id = p.id and m.author_id is distinct from p.id))
       )
  )
  select s.user_id, s.endpoint, s.p256dh, s.auth
    from public.push_subscriptions s
    join target t on t.id = s.user_id
$$;

-- Адреса родителей для письма о новом листке.
create function public.notify_parent_emails(p_leaflet uuid)
returns table (user_id uuid, email text, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, u.email::text, p.display_name
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.notification_prefs np on np.user_id = p.id
   where p.role = 'parent' and p.status = 'active' and coalesce(np.email_leaflet, true)
     and u.email is not null
     and exists (select 1 from public.leaflets l where l.id = p_leaflet and l.published_at <= clock_timestamp())
$$;

-- Взять задания в работу. Зависшие больше 2 минут берутся снова; после 5 попыток — бросаем.
create function public.notify_claim(p_limit int default 20)
returns setof public.notification_outbox
language sql volatile security definer set search_path = '' as $$
  update public.notification_outbox o
     set claimed_at = clock_timestamp(), attempts = o.attempts + 1
   where o.id in (
     select id from public.notification_outbox
      where sent_at is null and due_at <= clock_timestamp() and attempts < 5
        and (claimed_at is null or claimed_at < clock_timestamp() - interval '2 minutes')
      order by due_at
      limit least(greatest(p_limit, 1), 100)
      for update skip locked)
  returning o.*
$$;

create function public.notify_finish(p_id bigint, p_done boolean, p_push_sent int default 0,
                                     p_push_failed int default 0, p_emails_sent int default 0,
                                     p_note text default null)
returns void
language sql volatile security definer set search_path = '' as $$
  update public.notification_outbox
     set sent_at     = case when p_done then clock_timestamp() end,
         claimed_at  = null,
         push_sent   = coalesce(push_sent, 0) + p_push_sent,
         push_failed = p_push_failed,
         emails_sent = case when p_emails_sent > 0 then coalesce(emails_sent, 0) + p_emails_sent else emails_sent end,
         note        = left(p_note, 500)
   where id = p_id
$$;

-- Настройки отправки из Vault (секреты в базе зашифрованы; читать может только сервер).
--   rassvet_vapid_public, rassvet_vapid_private (JWK), rassvet_vapid_subject (mailto:…),
--   rassvet_notify_token (пароль для пробуждения функции), rassvet_notify_url (адрес функции).
create function private.secret(p_name text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if to_regclass('vault.decrypted_secrets') is null then return null; end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1' into v using p_name;
  return v;
end $$;
revoke all on function private.secret(text) from public, authenticated;

create function public.notify_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'vapid_public',  private.secret('rassvet_vapid_public'),
    'vapid_private', private.secret('rassvet_vapid_private'),
    'vapid_subject', private.secret('rassvet_vapid_subject'),
    'token',         private.secret('rassvet_notify_token'))
$$;

-- Публичный ключ VAPID нужен браузеру для подписки — он не секретный.
create function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select case when private.my_role() is not null then private.secret('rassvet_vapid_public') end
$$;

-- ─────────────────────────────────────────────────────────────
-- Пробуждение функции рассылки (pg_net) и расписание (pg_cron)
-- ─────────────────────────────────────────────────────────────
create function private.kick_notifications() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_token text;
begin
  if to_regnamespace('net') is null then return; end if;
  if not exists (select 1 from public.notification_outbox
                  where sent_at is null and due_at <= clock_timestamp() and attempts < 5) then
    return;
  end if;
  v_url := private.secret('rassvet_notify_url');
  v_token := private.secret('rassvet_notify_token');
  if v_url is null or v_token is null then return; end if;
  execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 20000)'
    using v_url, jsonb_build_object('Content-Type', 'application/json', 'x-notify-token', v_token);
end $$;
revoke all on function private.kick_notifications() from public, authenticated;

create function private.kick_after_enqueue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.kick_notifications();
  return null;
end $$;
create trigger notification_outbox_kick after insert on public.notification_outbox
  for each statement execute function private.kick_after_enqueue();

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.schedule('rassvet-notify', '*/5 * * * *', 'select private.kick_notifications()');
    -- Старые отправленные задания и журнал ответов pg_net не копим.
    perform cron.schedule('rassvet-notify-cleanup', '17 3 * * *', $c$
      delete from public.notification_outbox where sent_at < now() - interval '90 days';
      delete from cron.job_run_details where end_time < now() - interval '7 days';
    $c$);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Права на функции
-- ─────────────────────────────────────────────────────────────
revoke execute on function
  public.notify_recipients(text, uuid), public.notify_parent_emails(uuid),
  public.notify_claim(int), public.notify_finish(bigint, boolean, int, int, int, text),
  public.notify_config()
from public, anon, authenticated;
grant execute on function
  public.notify_recipients(text, uuid), public.notify_parent_emails(uuid),
  public.notify_claim(int), public.notify_finish(bigint, boolean, int, int, int, text),
  public.notify_config()
to service_role;

revoke execute on function public.push_subscribe(text, text, text, text), public.push_public_key() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text), public.push_public_key() to authenticated, service_role;
