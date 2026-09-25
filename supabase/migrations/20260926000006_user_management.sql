-- In-app user management for super admins: invite with courses in one step,
-- see who has signed in, grant access to people who asked for it, and keep an
-- audit trail of permission changes.

create table public.admin_log (
  id           bigint generated always as identity primary key,
  actor_email  text,
  action       text not null check (action in ('invite', 'role', 'courses', 'remove', 'dismiss')),
  target_email text not null,
  details      jsonb not null default '{}',
  at           timestamptz not null default now()
);
create index on public.admin_log (at desc);
alter table public.admin_log enable row level security;
-- Read through admin_activity(); no direct table access.

create or replace function public._log_admin(p_action text, p_target text, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_log (actor_email, action, target_email, details)
  values (public.current_email(), p_action, lower(p_target), coalesce(p_details, '{}'))
$$;

create or replace function public._course_names(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(name order by name), '[]'::jsonb) from public.courses where id = any(p_ids)
$$;

-- ---------------------------------------------------------------------------
-- Existing admin RPCs, now audited.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_admin(p_email text, p_role public.admin_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_old   public.admin_role;
begin
  perform public.assert_super_admin();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  if p_role <> 'super_admin' and v_email = public.current_email() then
    raise exception 'You cannot demote yourself' using errcode = '22023';
  end if;
  select role into v_old from public.admins where email = v_email;
  insert into public.admins (email, role) values (v_email, p_role)
  on conflict (email) do update set role = excluded.role;
  if v_old is null then
    perform public._log_admin('invite', v_email, jsonb_build_object('role', p_role));
  elsif v_old <> p_role then
    perform public._log_admin('role', v_email, jsonb_build_object('from', v_old, 'to', p_role));
  end if;
end
$$;

create or replace function public.remove_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_role  public.admin_role;
begin
  perform public.assert_super_admin();
  if v_email = public.current_email() then
    raise exception 'You cannot remove yourself' using errcode = '22023';
  end if;
  delete from public.admins where email = v_email returning role into v_role;
  if v_role is not null then
    perform public._log_admin('remove', v_email, jsonb_build_object('role', v_role));
  end if;
end
$$;

create or replace function public.set_admin_courses(p_email text, p_courses uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(btrim(p_email));
  v_before uuid[];
  v_after  uuid[];
begin
  perform public.assert_super_admin();
  if not exists (select 1 from public.admins where email = v_email) then
    raise exception 'Unknown admin %', v_email using errcode = 'P0002';
  end if;
  select coalesce(array_agg(course_id order by course_id), '{}') into v_before from public.course_admins where email = v_email;
  delete from public.course_admins where email = v_email and course_id <> all(coalesce(p_courses, '{}'));
  insert into public.course_admins (email, course_id)
  select v_email, c from unnest(coalesce(p_courses, '{}')) c
  where exists (select 1 from public.courses where id = c)
  on conflict do nothing;
  select coalesce(array_agg(course_id order by course_id), '{}') into v_after from public.course_admins where email = v_email;
  if v_before is distinct from v_after then
    perform public._log_admin('courses', v_email, jsonb_build_object(
      'added', public._course_names(array(select unnest(v_after) except select unnest(v_before))),
      'removed', public._course_names(array(select unnest(v_before) except select unnest(v_after)))
    ));
  end if;
end
$$;

-- Invite (or update) an admin with their courses in one transaction.
create or replace function public.invite_admin(p_email text, p_role public.admin_role, p_courses uuid[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.upsert_admin(p_email, p_role);
  if p_role = 'course_admin' then
    perform public.set_admin_courses(p_email, p_courses);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Directory, access requests and activity (super admin only).
-- ---------------------------------------------------------------------------
-- Admins with their courses and sign-in status.
create or replace function public.admin_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'email', a.email,
      'role', a.role,
      'created_at', a.created_at,
      'course_ids', coalesce((select jsonb_agg(ca.course_id) from public.course_admins ca where ca.email = a.email), '[]'::jsonb),
      'signed_up', u.id is not null,
      'last_sign_in_at', u.last_sign_in_at
    ) order by a.role desc, a.email)
    from public.admins a
    left join lateral (
      select id, last_sign_in_at from auth.users
      where lower(email) = a.email and email_confirmed_at is not null
      order by last_sign_in_at desc nulls last limit 1
    ) u on true
  ), '[]'::jsonb);
end
$$;

-- People who signed in but have no access yet (only possible while the
-- sign-up hook is disabled).
create or replace function public.access_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'email', lower(u.email), 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at
    ) order by u.created_at desc)
    from auth.users u
    where u.email is not null
      and u.email_confirmed_at is not null
      and not exists (select 1 from public.admins a where a.email = lower(u.email))
  ), '[]'::jsonb);
end
$$;

-- Remove a sign-in that has no access (it can sign in again later unless the
-- sign-up hook blocks it).
create or replace function public.dismiss_access_request(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  perform public.assert_super_admin();
  if exists (select 1 from public.admins where email = v_email) then
    raise exception '% is an admin; remove their access instead', v_email using errcode = '22023';
  end if;
  delete from auth.users where lower(email) = v_email;
  perform public._log_admin('dismiss', v_email);
end
$$;

create or replace function public.admin_activity(p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_super_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(l) order by l.at desc, l.id desc)
    from (select * from public.admin_log order by at desc, id desc limit least(greatest(p_limit, 1), 500)) l
  ), '[]'::jsonb);
end
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.invite_admin(text, public.admin_role, uuid[]), public.admin_directory(), public.access_requests(),
  public.dismiss_access_request(text), public.admin_activity(int)
to authenticated;
