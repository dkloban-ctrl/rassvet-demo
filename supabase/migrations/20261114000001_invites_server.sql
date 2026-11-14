-- Приглашения: всё, что нужно серверной функции регистрации.
-- Регистрация делается в два шага вокруг создания пользователя в Auth:
--   1) invite_lookup(code)  — проверить приглашение (без изменений);
--   2) создать пользователя в auth (edge-функция);
--   3) invite_complete(...) — под блокировкой строки: профиль, связь с родителем, «использовано».
-- Если шаг 3 упал, edge-функция удаляет созданного пользователя.

-- Для взрослых и помощников приглашение привязано к e-mail: утёкший код не даст
-- зарегистрироваться чужому человеку. Подростки входят по логину, их страхует согласие родителя.
alter table public.invites add column email text;
alter table public.invites drop constraint teen_invite_has_parent;
alter table public.invites add constraint invite_minor_has_parent
  check (role not in ('teen', 'helper') or parent_id is not null);
alter table public.invites add constraint invite_email_rule
  check ((role = 'teen' and email is null) or (role <> 'teen' and email is not null));
alter table public.invites add constraint invite_email_lower
  check (email is null or email = lower(btrim(email)));

-- Приглашение, созданное админом, одобрено сразу. Родительское ждёт админа.
create function private.invite_autoapprove() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_admin() then
    new.approved_by := auth.uid();
  end if;
  new.used_by := null;
  new.used_at := null;
  return new;
end $$;
create trigger invites_autoapprove before insert on public.invites
  for each row execute function private.invite_autoapprove();

create function public.invite_lookup(p_code text)
returns table (id uuid, role public.user_role, email text, parent_id uuid)
language sql stable security definer set search_path = '' as $$
  select i.id, i.role, i.email, i.parent_id
    from public.invites i
   where i.code = p_code
     and i.used_at is null
     and i.approved_by is not null
     and i.expires_at > now()
$$;

create function public.invite_complete(p_code text, p_user uuid, p_display_name text)
returns public.user_role
language plpgsql security definer set search_path = '' as $$
declare
  v public.invites;
  v_minor boolean;
begin
  select * into v from public.invites where code = p_code for update;
  if not found or v.used_at is not null or v.approved_by is null or v.expires_at <= now() then
    raise exception 'Приглашение недействительно или уже использовано' using errcode = 'P0002';
  end if;

  v_minor := v.role in ('teen', 'helper');

  -- Взрослые по приглашению админа активны сразу; несовершеннолетние ждут согласия.
  insert into public.profiles (id, display_name, role, is_minor, status)
  values (p_user, btrim(p_display_name), v.role, v_minor,
          case when v_minor then 'pending' else 'active' end::public.user_status);

  if v.parent_id is not null and v_minor then
    insert into public.family_links (parent_id, teen_id) values (v.parent_id, p_user);
  end if;

  update public.invites set used_by = p_user, used_at = clock_timestamp() where id = v.id;
  return v.role;
end $$;

-- Можно ли текущему вызывающему сбросить пароль этому пользователю:
-- админ — любому несовершеннолетнему; родитель — только своему ребёнку.
create function public.can_reset_password(p_actor uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles t where t.id = p_target and t.is_minor)
     and exists (
       select 1 from public.profiles a
        where a.id = p_actor and a.status = 'active'
          and (a.role = 'admin'
               or (a.role = 'parent'
                   and exists (select 1 from public.family_links f
                               where f.parent_id = p_actor and f.teen_id = p_target))))
$$;

-- Эти функции вызывает только сервер (service_role), никогда браузер.
revoke execute on function public.invite_lookup(text),
                           public.invite_complete(text, uuid, text),
                           public.can_reset_password(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.invite_lookup(text),
                          public.invite_complete(text, uuid, text),
                          public.can_reset_password(uuid, uuid)
  to service_role;

-- Админ одобряет запрос родителя.
create function public.approve_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Только админ' using errcode = '42501'; end if;
  update public.invites set approved_by = auth.uid()
   where id = p_invite and approved_by is null and used_at is null;
end $$;
revoke execute on function public.approve_invite(uuid) from public, anon;
grant execute on function public.approve_invite(uuid) to authenticated, service_role;
