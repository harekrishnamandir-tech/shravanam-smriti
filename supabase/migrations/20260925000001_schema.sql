-- Shravanam Smriti: core schema, access helpers and row-level security.
-- All writes go through SECURITY DEFINER RPCs (see later migrations); the
-- authenticated role can only SELECT, and RLS limits what it sees.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.admin_role as enum ('super_admin', 'course_admin');
create type public.course_status as enum ('active', 'paused', 'archived');
create type public.upload_action as enum ('create', 'replace', 'delete');

-- ---------------------------------------------------------------------------
-- Name normalisation (mirrors web/src/lib/nameKey.ts)
-- ---------------------------------------------------------------------------
create or replace function public.name_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(btrim(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_name, ''))), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.courses (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name                  text not null check (char_length(name) between 1 and 120),
  description           text not null default '' check (char_length(description) <= 2000),
  timezone              text not null default 'Asia/Kolkata',
  host_names            text[] not null default '{}',
  min_present_minutes   int not null default 10 check (min_present_minutes between 0 and 600),
  regular_threshold_pct int not null default 50 check (regular_threshold_pct between 1 and 100),
  schedule_note         text not null default '' check (char_length(schedule_note) <= 200),
  start_date            date,
  end_date              date,
  status                public.course_status not null default 'active',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.course_meeting_codes (
  meeting_code text primary key check (meeting_code ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  course_id    uuid not null references public.courses(id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index on public.course_meeting_codes (course_id);

-- Admins are keyed by email so access can be granted before first sign-in.
create table public.admins (
  email      text primary key check (email = lower(email) and email like '%@%'),
  role       public.admin_role not null,
  created_at timestamptz not null default now()
);

create table public.course_admins (
  email      text not null references public.admins(email) on delete cascade on update cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (email, course_id)
);
create index on public.course_admins (course_id);

create table public.participants (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 200),
  name_key     text not null unique,
  external_id  text,  -- reserved: link to an external contact record later
  created_at   timestamptz not null default now()
);
create index participants_name_trgm on public.participants using gin (name_key extensions.gin_trgm_ops);

-- Extra spellings that resolve to a participant (created by merges).
create table public.participant_aliases (
  alias_key      text primary key,
  participant_id uuid not null references public.participants(id) on delete cascade
);
create index on public.participant_aliases (participant_id);

create table public.sessions (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references public.courses(id) on delete cascade,
  session_date       date not null,
  seq                smallint not null default 1 check (seq between 1 and 20),
  meeting_code       text,
  started_at         timestamptz not null,
  ended_at           timestamptz not null,
  duration_sec       int generated always as (extract(epoch from (ended_at - started_at))::int) stored,
  source_filename    text check (char_length(source_filename) <= 255),
  uploaded_by_email  text,
  uploaded_at        timestamptz not null default now(),
  replaced_at        timestamptz,
  unique (course_id, session_date, seq),
  check (ended_at > started_at and ended_at - started_at <= interval '24 hours')
);
create index on public.sessions (course_id, started_at);

create table public.attendance (
  session_id      uuid not null references public.sessions(id) on delete cascade,
  participant_id  uuid not null references public.participants(id) on delete cascade,
  first_seen      timestamptz not null,
  seconds_in_call int not null check (seconds_in_call between 0 and 86400),
  primary key (session_id, participant_id)
);
create index on public.attendance (participant_id);

create table public.upload_log (
  id         bigint generated always as identity primary key,
  email      text,
  course_id  uuid references public.courses(id) on delete set null,
  session_id uuid,
  action     public.upload_action not null,
  rows       int not null default 0,
  details    jsonb not null default '{}',
  at         timestamptz not null default now()
);
create index on public.upload_log (course_id, at desc);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
-- The caller's verified email, or null.
create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
$$;

create or replace function public.current_role_name()
returns public.admin_role
language sql
stable
security definer
set search_path = ''
as $$
  select a.role from public.admins a where a.email = public.current_email()
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_role_name() = 'super_admin', false)
$$;

create or replace function public.can_access_course(p_course uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
      or exists (
        select 1
        from public.course_admins ca
        join public.admins a on a.email = ca.email
        where ca.email = public.current_email()
          and ca.course_id = p_course
      )
$$;

-- A participant is visible if they attended any course the caller can see.
create or replace function public.can_see_participant(p_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin()
      or exists (
        select 1
        from public.attendance at
        join public.sessions s on s.id = at.session_id
        where at.participant_id = p_participant
          and public.can_access_course(s.course_id)
      )
$$;

create or replace function public.assert_course_access(p_course uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_course is null or not public.can_access_course(p_course) then
    raise exception 'Not allowed for this course' using errcode = '42501';
  end if;
end
$$;

create or replace function public.assert_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super admin only' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Privileges + RLS
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- Postgres grants EXECUTE to PUBLIC globally; a schema-scoped revoke cannot undo that.
alter default privileges revoke execute on functions from public;

grant usage on schema public to authenticated;
grant select on
  public.courses, public.course_meeting_codes, public.admins, public.course_admins,
  public.participants, public.participant_aliases, public.sessions, public.attendance,
  public.upload_log
to authenticated;

alter table public.courses              enable row level security;
alter table public.course_meeting_codes enable row level security;
alter table public.admins               enable row level security;
alter table public.course_admins        enable row level security;
alter table public.participants         enable row level security;
alter table public.participant_aliases  enable row level security;
alter table public.sessions             enable row level security;
alter table public.attendance           enable row level security;
alter table public.upload_log           enable row level security;

create policy courses_read on public.courses
  for select to authenticated using (public.can_access_course(id));
create policy codes_read on public.course_meeting_codes
  for select to authenticated using (public.can_access_course(course_id));
create policy admins_read on public.admins
  for select to authenticated using (public.is_super_admin() or email = public.current_email());
create policy course_admins_read on public.course_admins
  for select to authenticated using (public.is_super_admin() or email = public.current_email());
create policy participants_read on public.participants
  for select to authenticated using (public.can_see_participant(id));
create policy aliases_read on public.participant_aliases
  for select to authenticated using (public.can_see_participant(participant_id));
create policy sessions_read on public.sessions
  for select to authenticated using (public.can_access_course(course_id));
create policy attendance_read on public.attendance
  for select to authenticated using (
    exists (select 1 from public.sessions s where s.id = session_id and public.can_access_course(s.course_id))
  );
create policy upload_log_read on public.upload_log
  for select to authenticated using (course_id is not null and public.can_access_course(course_id));

-- Helpers are needed by RLS policies evaluated as `authenticated`.
grant execute on function
  public.name_key(text), public.current_email(), public.current_role_name(),
  public.is_super_admin(), public.can_access_course(uuid), public.can_see_participant(uuid)
to authenticated;
