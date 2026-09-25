-- Write-path RPCs. Every function checks access itself; tables are read-only
-- for the `authenticated` role.

-- ---------------------------------------------------------------------------
-- Session / identity
-- ---------------------------------------------------------------------------
create or replace function public.ping()
returns text
language sql
stable
set search_path = ''
as $$ select 'ok'::text $$;

create or replace function public.me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when a.email is null then null else jsonb_build_object(
    'email', a.email,
    'role', a.role,
    'course_ids', coalesce((
      select jsonb_agg(c.id order by c.name)
      from public.courses c
      where public.can_access_course(c.id)
    ), '[]'::jsonb)
  ) end
  from (select public.current_email() as e) x
  left join public.admins a on a.email = x.e
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
-- Resolve (or create) the participant for a display name.
create or replace function public._resolve_participant(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := public.name_key(p_name);
  v_id  uuid;
begin
  select participant_id into v_id from public.participant_aliases where alias_key = v_key;
  if v_id is not null then return v_id; end if;

  select id into v_id from public.participants where name_key = v_key;
  if v_id is not null then return v_id; end if;

  insert into public.participants (display_name, name_key)
  values (regexp_replace(btrim(p_name), '\s+', ' ', 'g'), v_key)
  on conflict (name_key) do update set name_key = excluded.name_key
  returning id into v_id;
  return v_id;
end
$$;

-- Remove participants that no longer have any attendance.
create or replace function public._gc_participants(p_ids uuid[])
returns int
language sql
security definer
set search_path = ''
as $$
  with d as (
    delete from public.participants p
    where p.id = any(p_ids)
      and not exists (select 1 from public.attendance a where a.participant_id = p.id)
    returning 1
  )
  select count(*)::int from d
$$;

-- Renumber a course's sessions on one day by start time (seq 1 = earliest).
create or replace function public._renumber_day(p_course uuid, p_date date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sessions s set seq = r.rn
  from (
    select id, row_number() over (order by started_at, id) as rn
    from public.sessions where course_id = p_course and session_date = p_date
  ) r
  where s.id = r.id and s.seq is distinct from r.rn
$$;

-- The course's session whose time window overlaps [p_start, p_end), if any.
-- Two uploads describe the same session when their times overlap; sessions at
-- different times on the same day are separate sessions.
create or replace function public._overlapping_session(p_course uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.sessions
  where course_id = p_course
    and started_at < p_end and ended_at > p_start
    and (p_exclude is null or id <> p_exclude)
  order by least(ended_at, p_end) - greatest(started_at, p_start) desc
  limit 1
$$;

create or replace function public._session_json(p_session uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'course_id', s.course_id, 'session_date', s.session_date, 'seq', s.seq,
    'meeting_code', s.meeting_code, 'started_at', s.started_at, 'ended_at', s.ended_at,
    'duration_sec', s.duration_sec, 'source_filename', s.source_filename,
    'uploaded_by_email', s.uploaded_by_email, 'uploaded_at', s.uploaded_at, 'replaced_at', s.replaced_at,
    'rows', (select count(*) from public.attendance a where a.session_id = s.id)
  )
  from public.sessions s where s.id = p_session
$$;

-- ---------------------------------------------------------------------------
-- Upload preview: existing sessions that day + name resolution/suggestions.
-- ---------------------------------------------------------------------------
create or replace function public.upload_preview(
  p_course uuid, p_session_date date, p_names text[],
  p_started_at text default null, p_ended_at text default null  -- local 'YYYY-MM-DD HH:MM:SS'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_existing jsonb;
  v_names    jsonb;
  v_tz       text;
  v_start    timestamptz;
  v_end      timestamptz;
begin
  perform public.assert_course_access(p_course);
  select timezone into v_tz from public.courses where id = p_course;
  begin
    v_start := p_started_at::timestamp at time zone v_tz;
    v_end   := p_ended_at::timestamp at time zone v_tz;
  exception when others then
    v_start := null; v_end := null;
  end;
  if coalesce(array_length(p_names, 1), 0) > 2000 then
    raise exception 'Too many names' using errcode = '22023';
  end if;

  -- Sessions that day, each flagged when it overlaps the file's time window.
  select coalesce(jsonb_agg(public._session_json(s.id) || jsonb_build_object(
           'overlaps', v_start is not null and s.started_at < v_end and s.ended_at > v_start
         ) order by s.started_at), '[]'::jsonb)
    into v_existing
  from public.sessions s
  where s.course_id = p_course
    and (s.session_date = p_session_date or (v_start is not null and s.started_at < v_end and s.ended_at > v_start));

  with course_people as (
    select distinct p.id, p.display_name, p.name_key
    from public.participants p
    join public.attendance a on a.participant_id = p.id
    join public.sessions s on s.id = a.session_id
    where s.course_id = p_course
  ),
  input as (
    select n as name, public.name_key(n) as key from unnest(p_names) n
  ),
  resolved as (
    select i.name, i.key,
           coalesce(al.participant_id, p.id) as participant_id
    from input i
    left join public.participant_aliases al on al.alias_key = i.key
    left join public.participants p on p.name_key = i.key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', r.name,
    'key', r.key,
    'participant_id', case when r.participant_id is not null and public.can_see_participant(r.participant_id) then r.participant_id end,
    'is_new', r.participant_id is null,
    'suggestions', case when r.participant_id is null then coalesce((
      select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.display_name, 'score', round(similarity(cp.name_key, r.key)::numeric, 2))
                       order by similarity(cp.name_key, r.key) desc)
      from (select * from course_people cp2 where similarity(cp2.name_key, r.key) >= 0.45
            order by similarity(cp2.name_key, r.key) desc limit 3) cp
    ), '[]'::jsonb) else '[]'::jsonb end
  )), '[]'::jsonb)
  into v_names
  from resolved r;

  return jsonb_build_object('existing', v_existing, 'names', v_names);
end
$$;

-- ---------------------------------------------------------------------------
-- Ingest one Meet attendance export.
-- payload: {
--   course_id, mode: 'create'|'replace'|'append', session_id? (replace target),
--   meeting_code?, save_meeting_code?, started_at, ended_at   -- local 'YYYY-MM-DD HH:MM:SS'
--   source_filename?, rows: [{ name, first_seen, seconds }],
--   aliases?: [{ name, participant_id }]   -- "same person" choices from the preview
-- }
-- ---------------------------------------------------------------------------
create or replace function public.ingest_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course   public.courses;
  v_mode     text := coalesce(payload->>'mode', 'create');
  v_code     text := nullif(lower(btrim(payload->>'meeting_code')), '');
  v_start    timestamptz;
  v_end      timestamptz;
  v_date     date;
  v_seq      int;
  v_target   uuid;
  v_session  uuid;
  v_rows     int;
  v_old_ids  uuid[] := '{}';
  v_new_ppl  int;
  v_before   int;
  v_alias    jsonb;
  v_action   public.upload_action;
  v_old_date date;
begin
  select * into v_course from public.courses where id = (payload->>'course_id')::uuid;
  perform public.assert_course_access(v_course.id);

  if v_mode not in ('create', 'replace', 'append') then
    raise exception 'Invalid mode %', v_mode using errcode = '22023';
  end if;

  v_rows := coalesce(jsonb_array_length(payload->'rows'), 0);
  if v_rows = 0 or v_rows > 2000 then
    raise exception 'Expected 1-2000 attendance rows, got %', v_rows using errcode = '22023';
  end if;

  begin
    v_start := (payload->>'started_at')::timestamp at time zone v_course.timezone;
    v_end   := (payload->>'ended_at')::timestamp at time zone v_course.timezone;
  exception when others then
    raise exception 'Invalid session start/end time' using errcode = '22007';
  end;
  if v_end <= v_start or v_end - v_start > interval '24 hours' then
    raise exception 'Session end must be after start (max 24h)' using errcode = '22023';
  end if;
  v_date := (payload->>'started_at')::timestamp::date;

  -- Validate rows up front.
  if exists (
    select 1 from jsonb_to_recordset(payload->'rows') r(name text, first_seen text, seconds int)
    where r.name is null or char_length(btrim(r.name)) not between 1 and 200
       or public.name_key(r.name) = ''
       or r.seconds is null or r.seconds not between 0 and 86400
       or r.first_seen is null
  ) then
    raise exception 'Invalid attendance row (name 1-200 chars, seconds 0-86400, first_seen required)' using errcode = '22023';
  end if;

  -- Optional: remember the meeting code for this course.
  if v_code is not null and coalesce((payload->>'save_meeting_code')::boolean, false) then
    if exists (select 1 from public.course_meeting_codes where meeting_code = v_code and course_id <> v_course.id) then
      raise exception 'Meeting code % already belongs to another course', v_code using errcode = '23505';
    end if;
    insert into public.course_meeting_codes (meeting_code, course_id) values (v_code, v_course.id)
    on conflict (meeting_code) do nothing;
  end if;

  -- Pick the target session. Uploads are matched by time window, so a
  -- course can hold several sessions on the same day.
  if v_mode = 'replace' and payload ? 'session_id' then
    select id into v_target from public.sessions
    where id = (payload->>'session_id')::uuid and course_id = v_course.id;
    if v_target is null then
      raise exception 'Session to replace not found' using errcode = 'P0002';
    end if;
    if public._overlapping_session(v_course.id, v_start, v_end, v_target) is not null then
      raise exception 'This file overlaps a different session of the course' using errcode = '23P01';
    end if;
  elsif v_mode <> 'append' then
    v_target := public._overlapping_session(v_course.id, v_start, v_end);
    if v_target is not null and v_mode = 'create' then
      return jsonb_build_object('status', 'exists', 'existing', public._session_json(v_target));
    end if;
  end if;
  if v_target is not null then
    select session_date into v_old_date from public.sessions where id = v_target;
  end if;
  -- Provisional seq; the day is renumbered by start time below.
  select coalesce(max(seq), 0) + 1 into v_seq
  from public.sessions where course_id = v_course.id and session_date = v_date and id is distinct from v_target;

  if v_target is not null then
    select coalesce(array_agg(participant_id), '{}') into v_old_ids from public.attendance where session_id = v_target;
    delete from public.attendance where session_id = v_target;
    update public.sessions set
      session_date = v_date, seq = v_seq, meeting_code = v_code,
      started_at = v_start, ended_at = v_end,
      source_filename = left(payload->>'source_filename', 255),
      uploaded_by_email = public.current_email(), uploaded_at = now(), replaced_at = now()
    where id = v_target;
    v_session := v_target;
    v_action := 'replace';
  else
    insert into public.sessions (course_id, session_date, seq, meeting_code, started_at, ended_at, source_filename, uploaded_by_email)
    values (v_course.id, v_date, v_seq, v_code, v_start, v_end, left(payload->>'source_filename', 255), public.current_email())
    returning id into v_session;
    v_action := 'create';
  end if;

  perform public._renumber_day(v_course.id, v_date);
  if v_old_date is not null and v_old_date <> v_date then
    perform public._renumber_day(v_course.id, v_old_date);
  end if;

  -- "Same person" choices from the preview become aliases.
  for v_alias in select * from jsonb_array_elements(coalesce(payload->'aliases', '[]'::jsonb)) loop
    if public.can_see_participant((v_alias->>'participant_id')::uuid)
       and public.name_key(v_alias->>'name') <> ''
       and not exists (select 1 from public.participants where name_key = public.name_key(v_alias->>'name')) then
      insert into public.participant_aliases (alias_key, participant_id)
      values (public.name_key(v_alias->>'name'), (v_alias->>'participant_id')::uuid)
      on conflict (alias_key) do update set participant_id = excluded.participant_id;
    end if;
  end loop;

  select count(*) into v_before from public.participants;

  -- Aggregate rejoins / aliases that map to the same person.
  insert into public.attendance (session_id, participant_id, first_seen, seconds_in_call)
  select v_session, x.pid,
         min(x.first_seen),
         least(sum(x.seconds), 86400)
  from (
    select public._resolve_participant(r.name) as pid,
           (r.first_seen::timestamp at time zone v_course.timezone) as first_seen,
           r.seconds
    from jsonb_to_recordset(payload->'rows') r(name text, first_seen text, seconds int)
  ) x
  group by x.pid;

  select count(*) - v_before into v_new_ppl from public.participants;
  perform public._gc_participants(v_old_ids);

  insert into public.upload_log (email, course_id, session_id, action, rows, details)
  values (public.current_email(), v_course.id, v_session, v_action, v_rows,
          jsonb_build_object('filename', payload->>'source_filename', 'session_date', v_date,
                             'seq', (select seq from public.sessions where id = v_session), 'new_participants', v_new_ppl));

  return jsonb_build_object(
    'status', 'ok',
    'action', v_action,
    'session', public._session_json(v_session),
    'new_participants', v_new_ppl
  );
end
$$;

create or replace function public.delete_session(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s   public.sessions;
  v_ids uuid[];
  v_n   int;
begin
  select * into v_s from public.sessions where id = p_session;
  if v_s.id is null then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
  perform public.assert_course_access(v_s.course_id);

  select coalesce(array_agg(participant_id), '{}') into v_ids from public.attendance where session_id = p_session;
  delete from public.sessions where id = p_session;
  perform public._renumber_day(v_s.course_id, v_s.session_date);
  v_n := public._gc_participants(v_ids);

  insert into public.upload_log (email, course_id, session_id, action, rows, details)
  values (public.current_email(), v_s.course_id, p_session, 'delete', coalesce(array_length(v_ids, 1), 0),
          jsonb_build_object('session_date', v_s.session_date, 'seq', v_s.seq, 'filename', v_s.source_filename));

  return jsonb_build_object('status', 'ok', 'removed_participants', v_n);
end
$$;

-- ---------------------------------------------------------------------------
-- Courses
-- ---------------------------------------------------------------------------
create or replace function public._clean_host_names(p jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct btrim(h)) filter (where btrim(h) <> ''), '{}')
  from jsonb_array_elements_text(coalesce(p, '[]'::jsonb)) h
$$;

create or replace function public._assert_timezone(p_tz text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_tz) then
    raise exception 'Unknown timezone %', p_tz using errcode = '22023';
  end if;
end
$$;

create or replace function public.create_course(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.assert_super_admin();
  perform public._assert_timezone(coalesce(p->>'timezone', 'Asia/Kolkata'));
  insert into public.courses (slug, name, description, timezone, host_names, min_present_minutes,
                              regular_threshold_pct, schedule_note, start_date, end_date, status)
  values (
    lower(btrim(p->>'slug')), btrim(p->>'name'), coalesce(p->>'description', ''),
    coalesce(p->>'timezone', 'Asia/Kolkata'), public._clean_host_names(p->'host_names'),
    coalesce((p->>'min_present_minutes')::int, 10), coalesce((p->>'regular_threshold_pct')::int, 50),
    coalesce(p->>'schedule_note', ''), nullif(p->>'start_date', '')::date, nullif(p->>'end_date', '')::date,
    coalesce(p->>'status', 'active')::public.course_status
  )
  returning id into v_id;
  return v_id;
end
$$;

-- Partial update: only keys present in `p` change.
create or replace function public.update_course(p_course uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_course_access(p_course);
  if p ? 'timezone' then perform public._assert_timezone(p->>'timezone'); end if;
  update public.courses c set
    slug                  = case when p ? 'slug' then lower(btrim(p->>'slug')) else c.slug end,
    name                  = case when p ? 'name' then btrim(p->>'name') else c.name end,
    description           = case when p ? 'description' then coalesce(p->>'description', '') else c.description end,
    timezone              = case when p ? 'timezone' then p->>'timezone' else c.timezone end,
    host_names            = case when p ? 'host_names' then public._clean_host_names(p->'host_names') else c.host_names end,
    min_present_minutes   = case when p ? 'min_present_minutes' then (p->>'min_present_minutes')::int else c.min_present_minutes end,
    regular_threshold_pct = case when p ? 'regular_threshold_pct' then (p->>'regular_threshold_pct')::int else c.regular_threshold_pct end,
    schedule_note         = case when p ? 'schedule_note' then coalesce(p->>'schedule_note', '') else c.schedule_note end,
    start_date            = case when p ? 'start_date' then nullif(p->>'start_date', '')::date else c.start_date end,
    end_date              = case when p ? 'end_date' then nullif(p->>'end_date', '')::date else c.end_date end,
    status                = case when p ? 'status' then (p->>'status')::public.course_status else c.status end,
    updated_at            = now()
  where c.id = p_course;
end
$$;

create or replace function public.set_meeting_codes(p_course uuid, p_codes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_codes text[];
  v_taken text;
begin
  perform public.assert_course_access(p_course);
  select coalesce(array_agg(distinct lower(btrim(c))) filter (where btrim(c) <> ''), '{}')
    into v_codes from unnest(coalesce(p_codes, '{}')) c;

  select meeting_code into v_taken from public.course_meeting_codes
  where meeting_code = any(v_codes) and course_id <> p_course limit 1;
  if v_taken is not null then
    raise exception 'Meeting code % already belongs to another course', v_taken using errcode = '23505';
  end if;

  delete from public.course_meeting_codes where course_id = p_course and meeting_code <> all(v_codes);
  insert into public.course_meeting_codes (meeting_code, course_id)
  select c, p_course from unnest(v_codes) c
  on conflict (meeting_code) do nothing;
end
$$;

create or replace function public.delete_course(p_course uuid, p_confirm_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c   public.courses;
  v_ids uuid[];
begin
  perform public.assert_super_admin();
  select * into v_c from public.courses where id = p_course;
  if v_c.id is null then raise exception 'Course not found' using errcode = 'P0002'; end if;
  if v_c.status <> 'archived' then raise exception 'Archive the course before deleting it' using errcode = '22023'; end if;
  if v_c.slug <> p_confirm_slug then raise exception 'Confirmation does not match the course slug' using errcode = '22023'; end if;

  select coalesce(array_agg(distinct a.participant_id), '{}') into v_ids
  from public.attendance a join public.sessions s on s.id = a.session_id where s.course_id = p_course;
  delete from public.courses where id = p_course;
  perform public._gc_participants(v_ids);
end
$$;

-- ---------------------------------------------------------------------------
-- Participants
-- ---------------------------------------------------------------------------
-- True when the caller may edit this participant: super admin, or every
-- course the participant appears in is accessible to the caller.
create or replace function public._can_edit_participant(p_participant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_super_admin() or (
    public.can_see_participant(p_participant)
    and not exists (
      select 1 from public.attendance a join public.sessions s on s.id = a.session_id
      where a.participant_id = p_participant and not public.can_access_course(s.course_id)
    )
  )
$$;

create or replace function public.rename_participant(p_participant uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public._can_edit_participant(p_participant) then
    raise exception 'Not allowed to edit this participant' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 200 then
    raise exception 'Name must be 1-200 characters' using errcode = '22023';
  end if;
  update public.participants set display_name = regexp_replace(btrim(p_name), '\s+', ' ', 'g') where id = p_participant;
end
$$;

-- Fold `p_merge` into `p_keep`; its spellings become aliases of `p_keep`.
create or replace function public.merge_participants(p_keep uuid, p_merge uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_keep = p_merge then raise exception 'Cannot merge a participant into itself' using errcode = '22023'; end if;
  if not (public._can_edit_participant(p_keep) and public._can_edit_participant(p_merge)) then
    raise exception 'Not allowed to merge these participants' using errcode = '42501';
  end if;
  select name_key into v_key from public.participants where id = p_merge;
  if v_key is null then raise exception 'Participant not found' using errcode = 'P0002'; end if;

  insert into public.attendance (session_id, participant_id, first_seen, seconds_in_call)
  select session_id, p_keep, first_seen, seconds_in_call from public.attendance where participant_id = p_merge
  on conflict (session_id, participant_id) do update set
    first_seen = least(public.attendance.first_seen, excluded.first_seen),
    seconds_in_call = least(public.attendance.seconds_in_call + excluded.seconds_in_call, 86400);

  update public.participant_aliases set participant_id = p_keep where participant_id = p_merge;
  delete from public.participants where id = p_merge;
  insert into public.participant_aliases (alias_key, participant_id) values (v_key, p_keep)
  on conflict (alias_key) do update set participant_id = excluded.participant_id;
end
$$;

-- Detach an alias so that spelling becomes its own participant on next upload.
create or replace function public.remove_alias(p_alias_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pid uuid;
begin
  select participant_id into v_pid from public.participant_aliases where alias_key = p_alias_key;
  if v_pid is null or not public._can_edit_participant(v_pid) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.participant_aliases where alias_key = p_alias_key;
end
$$;

-- ---------------------------------------------------------------------------
-- Admin management (super admin only)
-- ---------------------------------------------------------------------------
create or replace function public.upsert_admin(p_email text, p_role public.admin_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  perform public.assert_super_admin();
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  if p_role <> 'super_admin' and v_email = public.current_email() then
    raise exception 'You cannot demote yourself' using errcode = '22023';
  end if;
  insert into public.admins (email, role) values (v_email, p_role)
  on conflict (email) do update set role = excluded.role;
end
$$;

create or replace function public.remove_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_super_admin();
  if lower(p_email) = public.current_email() then
    raise exception 'You cannot remove yourself' using errcode = '22023';
  end if;
  delete from public.admins where email = lower(p_email);
end
$$;

create or replace function public.set_admin_courses(p_email text, p_courses uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
begin
  perform public.assert_super_admin();
  if not exists (select 1 from public.admins where email = v_email) then
    raise exception 'Unknown admin %', v_email using errcode = 'P0002';
  end if;
  delete from public.course_admins where email = v_email and course_id <> all(coalesce(p_courses, '{}'));
  insert into public.course_admins (email, course_id)
  select v_email, c from unnest(coalesce(p_courses, '{}')) c
  on conflict do nothing;
end
$$;

-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function public.ping() to anon, authenticated;
grant execute on function
  public.me(), public.upload_preview(uuid, date, text[], text, text), public.ingest_session(jsonb),
  public.delete_session(uuid), public.create_course(jsonb), public.update_course(uuid, jsonb),
  public.set_meeting_codes(uuid, text[]), public.delete_course(uuid, text),
  public.rename_participant(uuid, text), public.merge_participants(uuid, uuid), public.remove_alias(text),
  public.upsert_admin(text, public.admin_role), public.remove_admin(text), public.set_admin_courses(text, uuid[])
to authenticated;
