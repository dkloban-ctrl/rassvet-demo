-- «Рассвет» — MVP-1 «Неделя»: схема, права (RLS), аудит.
-- Принцип: всё, что касается доступа, решает база. Экран может ошибиться — база нет.
-- Время фиксирует сервер (clock_timestamp), клиент время не задаёт.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Типы
-- ─────────────────────────────────────────────────────────────
create type public.user_role   as enum ('admin', 'helper', 'parent', 'teen');
create type public.user_status as enum ('pending', 'active', 'blocked');
create type public.thread_kind as enum ('message', 'report');
create type public.thread_status as enum ('open', 'closed');

-- ─────────────────────────────────────────────────────────────
-- Люди
-- ─────────────────────────────────────────────────────────────
-- Минимум данных: только имя (без фамилии), роль, статус.
-- Логин подростка живёт в auth.users как технический адрес, сюда не попадает.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  role         public.user_role   not null,
  is_minor     boolean            not null default false,
  status       public.user_status not null default 'pending',
  created_at   timestamptz        not null default now(),
  constraint teen_is_minor      check (role <> 'teen' or is_minor),
  constraint adults_not_minor   check (role not in ('admin', 'parent') or not is_minor)
);

create table public.family_links (
  parent_id  uuid not null references public.profiles (id) on delete cascade,
  teen_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, teen_id)
);

create table public.consent_documents (
  version      text primary key,
  title        text not null,
  url          text,
  is_current   boolean not null default false,
  published_at timestamptz not null default now()
);
create unique index consent_documents_one_current on public.consent_documents (is_current) where is_current;

create table public.consents (
  id         uuid primary key default gen_random_uuid(),
  teen_id    uuid not null,
  parent_id  uuid not null,
  version    text not null references public.consent_documents (version),
  signed_at  timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key (parent_id, teen_id) references public.family_links (parent_id, teen_id) on delete cascade
);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique default replace(gen_random_uuid()::text, '-', ''),
  role        public.user_role not null,
  parent_id   uuid references public.profiles (id) on delete cascade, -- к кому привязать подростка
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  approved_by uuid references public.profiles (id) on delete set null,
  expires_at  timestamptz not null default now() + interval '7 days',
  used_by     uuid references public.profiles (id) on delete set null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  constraint teen_invite_has_parent check (role <> 'teen' or parent_id is not null)
);

-- ─────────────────────────────────────────────────────────────
-- Содержание недели
-- ─────────────────────────────────────────────────────────────
create table public.leaflets (
  id           uuid primary key default gen_random_uuid(),
  week         date not null unique,           -- понедельник недели
  title        text not null,
  body         text not null,                  -- markdown
  verse_ref    text,
  verse_text   text,
  image_path   text,                           -- путь в Storage (этап 3)
  published_at timestamptz,                    -- null = черновик
  author_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.questions (
  id           uuid primary key default gen_random_uuid(),
  week         date not null unique,
  body         text not null,
  published_at timestamptz,
  closes_at    timestamptz,                    -- null = без срока
  created_at   timestamptz not null default now()
);

create table public.answers (
  id           uuid primary key default gen_random_uuid(),
  question_id  uuid not null references public.questions (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  is_anonymous boolean not null default false,
  created_at   timestamptz not null default clock_timestamp(),
  hidden_at    timestamptz,
  hidden_by    uuid references public.profiles (id) on delete set null,
  unique (question_id, author_id)
);

create table public.answer_replies (
  id         uuid primary key default gen_random_uuid(),
  answer_id  uuid not null references public.answers (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null default auth.uid(),
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  pinned       boolean not null default false,
  published_at timestamptz,
  author_id    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  place      text,
  note       text,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- «Написать лидеру»: общий ящик всех админов
-- ─────────────────────────────────────────────────────────────
create table public.inbox_threads (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid references public.profiles (id) on delete set null default auth.uid(),
  kind       public.thread_kind   not null default 'message',
  status     public.thread_status not null default 'open',
  created_at timestamptz not null default clock_timestamp()
);

-- Сообщения неизменяемы: ни правки, ни удаления (кроме удаления аккаунта).
create table public.inbox_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.inbox_threads (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null default auth.uid(),
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default clock_timestamp()
);

-- Доступ родителя к обращениям своего ребёнка. Открывает только админ.
-- Действует ТОЛЬКО на сообщения после granted_at; granted_at ставит сервер.
create table public.parent_inbox_access (
  id         uuid primary key default gen_random_uuid(),
  parent_id  uuid not null,
  teen_id    uuid not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default clock_timestamp(),
  revoked_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  foreign key (parent_id, teen_id) references public.family_links (parent_id, teen_id) on delete cascade
);
create unique index parent_inbox_access_one_active
  on public.parent_inbox_access (parent_id, teen_id) where revoked_at is null;

-- ─────────────────────────────────────────────────────────────
-- Служебное
-- ─────────────────────────────────────────────────────────────
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Журнал: без внешних ключей, чтобы записи переживали удаление людей.
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default clock_timestamp(),
  actor_id   uuid,
  action     text not null,
  table_name text,
  row_id     text,
  old_data   jsonb,
  new_data   jsonb
);

create index on public.answers (question_id);
create index on public.answer_replies (answer_id);
create index on public.inbox_messages (thread_id, created_at);
create index on public.inbox_threads (author_id);
create index on public.family_links (teen_id);
create index on public.consents (teen_id);

-- ─────────────────────────────────────────────────────────────
-- Вспомогательные функции (private: не видны через API)
-- ─────────────────────────────────────────────────────────────
-- Роль текущего пользователя; null, если он не активен. Все политики опираются на неё,
-- поэтому заблокированный или неактивированный пользователь не видит ничего.
create function private.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.status = 'active'
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'admin', false)
$$;

create function private.is_parent_of(p_teen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() = 'parent'
     and exists (select 1 from public.family_links f
                 where f.parent_id = auth.uid() and f.teen_id = p_teen)
$$;

create function private.is_child_of(p_parent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() is not null
     and exists (select 1 from public.family_links f
                 where f.teen_id = auth.uid() and f.parent_id = p_parent)
$$;

create function private.question_open(p_question uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.questions q
                 where q.id = p_question
                   and q.published_at <= now()
                   and (q.closes_at is null or q.closes_at > now()))
$$;

-- Видит ли текущий пользователь ответ (для ответов лидеров на ответы).
create function private.answer_visible(p_answer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.answers a join public.questions q on q.id = a.question_id
    where a.id = p_answer
      and (private.is_admin()
           or (private.my_role() in ('helper', 'teen')
               and q.published_at <= now()
               and (a.hidden_at is null or a.author_id = auth.uid()))))
$$;

create function private.has_valid_consent(p_teen uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.consents c
                 join public.consent_documents d on d.version = c.version and d.is_current
                 where c.teen_id = p_teen and c.revoked_at is null)
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- Триггеры целостности
-- ─────────────────────────────────────────────────────────────
-- Несовершеннолетнего (подростка или помощника) нельзя активировать без действующего согласия.
create function private.check_minor_activation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and new.is_minor and not private.has_valid_consent(new.id) then
    raise exception 'Нельзя активировать несовершеннолетнего без согласия родителя'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger profiles_minor_activation before insert or update on public.profiles
  for each row execute function private.check_minor_activation();

-- Связь «родитель — ребёнок»: слева взрослый родитель, справа несовершеннолетний.
create function private.check_family_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.parent_id and role = 'parent') then
    raise exception 'parent_id должен быть родителем';
  end if;
  if not exists (select 1 from public.profiles where id = new.teen_id and is_minor) then
    raise exception 'teen_id должен быть несовершеннолетним';
  end if;
  return new;
end $$;
create trigger family_links_check before insert or update on public.family_links
  for each row execute function private.check_family_link();

-- Время и авторство ставит сервер, а не клиент.
create function private.force_server_fields() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := clock_timestamp();
  if auth.uid() is not null then
    new.author_id := auth.uid();
  end if;
  return new;
end $$;
create trigger inbox_threads_server_fields  before insert on public.inbox_threads
  for each row execute function private.force_server_fields();
create trigger inbox_messages_server_fields before insert on public.inbox_messages
  for each row execute function private.force_server_fields();
create trigger answers_server_fields        before insert on public.answers
  for each row execute function private.force_server_fields();
create trigger answer_replies_server_fields before insert on public.answer_replies
  for each row execute function private.force_server_fields();

-- granted_at нельзя задать задним числом и нельзя поменять потом.
create function private.guard_parent_access() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.granted_at := clock_timestamp();
    new.revoked_at := null;
  else
    if new.granted_at is distinct from old.granted_at
       or new.parent_id <> old.parent_id or new.teen_id <> old.teen_id then
      raise exception 'Выданный доступ нельзя переписать — только отозвать';
    end if;
    if old.revoked_at is not null then
      raise exception 'Отозванный доступ нельзя вернуть — выдайте новый';
    end if;
  end if;
  return new;
end $$;
create trigger parent_inbox_access_guard before insert or update on public.parent_inbox_access
  for each row execute function private.guard_parent_access();

-- ─────────────────────────────────────────────────────────────
-- Журнал действий
-- ─────────────────────────────────────────────────────────────
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id',
                   concat_ws(':', coalesce(v_new, v_old) ->> 'parent_id', coalesce(v_new, v_old) ->> 'teen_id')),
          v_old, v_new);
  return coalesce(new, old);
end $$;

create trigger audit_profiles after update or delete on public.profiles
  for each row execute function private.audit_row();
create trigger audit_family_links after insert or update or delete on public.family_links
  for each row execute function private.audit_row();
create trigger audit_consents after insert or update or delete on public.consents
  for each row execute function private.audit_row();
create trigger audit_invites after insert or update or delete on public.invites
  for each row execute function private.audit_row();
create trigger audit_parent_inbox_access after insert or update or delete on public.parent_inbox_access
  for each row execute function private.audit_row();
create trigger audit_answers after update or delete on public.answers
  for each row execute function private.audit_row();
create trigger audit_leaflets after delete on public.leaflets
  for each row execute function private.audit_row();
create trigger audit_questions after delete on public.questions
  for each row execute function private.audit_row();

-- ─────────────────────────────────────────────────────────────
-- Права на таблицы (поверх RLS)
-- ─────────────────────────────────────────────────────────────
alter table public.profiles            enable row level security;
alter table public.family_links        enable row level security;
alter table public.consent_documents   enable row level security;
alter table public.consents            enable row level security;
alter table public.invites             enable row level security;
alter table public.leaflets            enable row level security;
alter table public.questions           enable row level security;
alter table public.answers             enable row level security;
alter table public.answer_replies      enable row level security;
alter table public.announcements       enable row level security;
alter table public.events              enable row level security;
alter table public.inbox_threads       enable row level security;
alter table public.inbox_messages      enable row level security;
alter table public.parent_inbox_access enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.audit_log           enable row level security;

-- Анонимам (без входа) не даём ничего.
revoke all on all tables in schema public from anon;

-- Профили, согласия по отзыву, доступ родителей, журнал меняются только через функции ниже.
revoke insert, update, delete on public.profiles            from authenticated;
revoke update, delete         on public.consents            from authenticated;
revoke insert, update, delete on public.parent_inbox_access from authenticated;
revoke insert, update, delete on public.audit_log           from authenticated;
revoke update, delete         on public.inbox_messages      from authenticated;
-- Подросток может поправить только текст и режим анонимности своего ответа.
revoke update on public.answers from authenticated;
grant  update (body, is_anonymous) on public.answers to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Политики RLS
-- ─────────────────────────────────────────────────────────────
-- profiles: каждый видит только тех, кто ему нужен.
create policy profiles_select on public.profiles for select to authenticated using (
  private.is_admin()
  or id = auth.uid()
  -- ребята и помощники видят друг друга и лидеров (имена в ответах)
  or (private.my_role() in ('teen', 'helper') and role in ('teen', 'helper', 'admin') and status = 'active')
  -- родитель видит своих детей и лидеров
  or (private.my_role() = 'parent' and (role = 'admin' or private.is_parent_of(id)))
  -- ребёнок видит своих родителей (кто может читать его обращения)
  or private.is_child_of(id)
);

create policy family_links_select on public.family_links for select to authenticated using (
  private.is_admin()
  or (private.my_role() is not null and (parent_id = auth.uid() or teen_id = auth.uid()))
);
create policy family_links_admin_write on public.family_links for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy consent_documents_select on public.consent_documents for select to authenticated
  using (private.my_role() is not null);
create policy consent_documents_admin_write on public.consent_documents for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy consents_select on public.consents for select to authenticated using (
  private.is_admin()
  or (private.my_role() is not null and (parent_id = auth.uid() or teen_id = auth.uid()))
);
-- Согласие подписывает только сам родитель и только за своего ребёнка, по текущей версии.
create policy consents_parent_sign on public.consents for insert to authenticated with check (
  parent_id = auth.uid()
  and private.is_parent_of(teen_id)
  and revoked_at is null
  and exists (select 1 from public.consent_documents d where d.version = consents.version and d.is_current)
);

create policy invites_select on public.invites for select to authenticated using (
  private.is_admin() or (private.my_role() = 'parent' and parent_id = auth.uid())
);
create policy invites_admin_write on public.invites for all to authenticated
  using (private.is_admin()) with check (private.is_admin());
-- Родитель может запросить приглашение для своего ребёнка; работает после одобрения админа.
create policy invites_parent_request on public.invites for insert to authenticated with check (
  private.my_role() = 'parent'
  and role = 'teen' and parent_id = auth.uid()
  and created_by = auth.uid()
  and approved_by is null and used_by is null and used_at is null
);

-- Листок недели и объявления: читают все активные, пишут админы.
create policy leaflets_select on public.leaflets for select to authenticated using (
  private.is_admin() or (private.my_role() is not null and published_at <= now())
);
create policy leaflets_admin_write on public.leaflets for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy announcements_select on public.announcements for select to authenticated using (
  private.is_admin() or (private.my_role() is not null and published_at <= now())
);
create policy announcements_admin_write on public.announcements for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy events_select on public.events for select to authenticated
  using (private.my_role() is not null);
create policy events_admin_write on public.events for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Вопрос недели: родители его не видят (по ТЗ).
create policy questions_select on public.questions for select to authenticated using (
  private.is_admin() or (private.my_role() in ('helper', 'teen') and published_at <= now())
);
create policy questions_admin_write on public.questions for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Ответы: напрямую из таблицы — только свой ответ и всё для админов.
-- Остальные читают ленту через public.answers_feed(), где автор анонимного ответа скрыт.
create policy answers_select on public.answers for select to authenticated using (
  private.is_admin() or (private.my_role() is not null and author_id = auth.uid())
);
create policy answers_teen_insert on public.answers for insert to authenticated with check (
  private.my_role() = 'teen'
  and author_id = auth.uid()
  and hidden_at is null and hidden_by is null
  and private.question_open(question_id)
);
create policy answers_own_update on public.answers for update to authenticated
  using (private.my_role() = 'teen' and author_id = auth.uid() and private.question_open(question_id))
  with check (author_id = auth.uid());
create policy answers_delete on public.answers for delete to authenticated using (
  private.is_admin()
  or (private.my_role() = 'teen' and author_id = auth.uid() and private.question_open(question_id))
);

create policy answer_replies_select on public.answer_replies for select to authenticated
  using (private.answer_visible(answer_id));
create policy answer_replies_admin_write on public.answer_replies for all to authenticated
  using (private.is_admin()) with check (private.is_admin() and author_id = auth.uid());

-- Ящик лидеров: автор видит свою переписку, админы — всё. Помощники — нет.
create policy inbox_threads_select on public.inbox_threads for select to authenticated using (
  private.is_admin() or (private.my_role() is not null and author_id = auth.uid())
);
create policy inbox_threads_insert on public.inbox_threads for insert to authenticated with check (
  private.my_role() is not null and author_id = auth.uid() and status = 'open'
);
create policy inbox_threads_admin_update on public.inbox_threads for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy inbox_messages_select on public.inbox_messages for select to authenticated using (
  private.is_admin()
  or (private.my_role() is not null
      and exists (select 1 from public.inbox_threads t where t.id = thread_id and t.author_id = auth.uid()))
);
create policy inbox_messages_insert on public.inbox_messages for insert to authenticated with check (
  author_id = auth.uid()
  and (private.is_admin()
       or (private.my_role() is not null
           and exists (select 1 from public.inbox_threads t
                       where t.id = thread_id and t.author_id = auth.uid() and t.status = 'open')))
);

-- Кто может читать мои обращения: ребёнок обязан это видеть.
create policy parent_inbox_access_select on public.parent_inbox_access for select to authenticated using (
  private.is_admin()
  or (private.my_role() is not null and (parent_id = auth.uid() or teen_id = auth.uid()))
);

create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.my_role() is not null);

create policy audit_admin_select on public.audit_log for select to authenticated
  using (private.is_admin());

-- ─────────────────────────────────────────────────────────────
-- Функции для приложения (RPC)
-- ─────────────────────────────────────────────────────────────
-- Лента ответов на вопрос. Имя автора анонимного ответа получают только админы
-- (и сам автор). Родители получают пустой результат.
create function public.answers_feed(p_question uuid)
returns table (id uuid, body text, is_anonymous boolean, author_id uuid, author_name text,
               is_mine boolean, is_hidden boolean, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.body, a.is_anonymous,
         case when not a.is_anonymous or private.is_admin() or a.author_id = auth.uid()
              then a.author_id end,
         case when not a.is_anonymous or private.is_admin() or a.author_id = auth.uid()
              then p.display_name end,
         a.author_id = auth.uid(),
         a.hidden_at is not null,
         a.created_at
  from public.answers a
  join public.questions q on q.id = a.question_id
  left join public.profiles p on p.id = a.author_id
  where a.question_id = p_question
    and (private.is_admin()
         or (private.my_role() in ('helper', 'teen')
             and q.published_at <= now()
             and (a.hidden_at is null or a.author_id = auth.uid())))
  order by a.created_at
$$;

create function public.hide_answer(p_answer uuid, p_hidden boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Только админ' using errcode = '42501'; end if;
  update public.answers
     set hidden_at = case when p_hidden then clock_timestamp() end,
         hidden_by = case when p_hidden then auth.uid() end
   where id = p_answer;
end $$;

-- Смена роли / статуса — только админ, всегда с записью в журнал (триггер audit_profiles).
create function public.admin_update_profile(
  p_user uuid, p_role public.user_role default null, p_status public.user_status default null,
  p_is_minor boolean default null, p_display_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Только админ' using errcode = '42501'; end if;
  if p_user = auth.uid() and (p_role is distinct from null and p_role <> 'admin'
                              or p_status is distinct from null and p_status <> 'active') then
    raise exception 'Админ не может разжаловать или заблокировать сам себя';
  end if;
  update public.profiles set
    role         = coalesce(p_role, role),
    status       = coalesce(p_status, status),
    is_minor     = coalesce(p_is_minor, is_minor),
    display_name = coalesce(p_display_name, display_name)
  where id = p_user;
end $$;

-- Отзыв согласия: родитель (своё) или админ. Ребёнок сразу деактивируется.
create function public.revoke_consent(p_consent uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_teen uuid;
begin
  update public.consents c set revoked_at = clock_timestamp()
   where c.id = p_consent and c.revoked_at is null
     and (private.is_admin() or (private.my_role() = 'parent' and c.parent_id = auth.uid()))
  returning c.teen_id into v_teen;
  if v_teen is null then raise exception 'Нет такого действующего согласия или нет прав' using errcode = '42501'; end if;
  if not private.has_valid_consent(v_teen) then
    update public.profiles set status = 'pending' where id = v_teen and is_minor and status = 'active';
  end if;
end $$;

-- Открыть / закрыть родителю обращения ребёнка. Время ставит сервер.
create function public.grant_parent_inbox_access(p_parent uuid, p_teen uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'Только админ' using errcode = '42501'; end if;
  insert into public.parent_inbox_access (parent_id, teen_id, granted_by)
  values (p_parent, p_teen, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.revoke_parent_inbox_access(p_access uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Только админ' using errcode = '42501'; end if;
  update public.parent_inbox_access
     set revoked_at = clock_timestamp(), revoked_by = auth.uid()
   where id = p_access and revoked_at is null;
end $$;

-- Родитель читает обращения ребёнка: только при открытом доступе, только после granted_at.
-- Каждое чтение пишется в журнал.
create function public.child_inbox(p_teen uuid)
returns table (thread_id uuid, message_id uuid, author_name text, body text, created_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare v_since timestamptz;
begin
  select a.granted_at into v_since
    from public.parent_inbox_access a
   where a.parent_id = auth.uid() and a.teen_id = p_teen and a.revoked_at is null
     and private.is_parent_of(p_teen);
  if v_since is null then
    raise exception 'Доступ к обращениям не открыт' using errcode = '42501';
  end if;

  insert into public.audit_log (actor_id, action, table_name, row_id)
  values (auth.uid(), 'parent_read_inbox', 'inbox_messages', p_teen::text);

  return query
    select m.thread_id, m.id, p.display_name, m.body, m.created_at
      from public.inbox_messages m
      join public.inbox_threads t on t.id = m.thread_id
      left join public.profiles p on p.id = m.author_id
     where t.author_id = p_teen and m.created_at >= v_since
     order by m.created_at;
end $$;

revoke execute on function
  public.answers_feed(uuid), public.hide_answer(uuid, boolean),
  public.admin_update_profile(uuid, public.user_role, public.user_status, boolean, text),
  public.revoke_consent(uuid), public.grant_parent_inbox_access(uuid, uuid),
  public.revoke_parent_inbox_access(uuid), public.child_inbox(uuid)
from public, anon;
grant execute on function
  public.answers_feed(uuid), public.hide_answer(uuid, boolean),
  public.admin_update_profile(uuid, public.user_role, public.user_status, boolean, text),
  public.revoke_consent(uuid), public.grant_parent_inbox_access(uuid, uuid),
  public.revoke_parent_inbox_access(uuid), public.child_inbox(uuid)
to authenticated, service_role;
