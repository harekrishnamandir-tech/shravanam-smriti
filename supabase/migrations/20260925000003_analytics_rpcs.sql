-- Read-path analytics. Functions return jsonb so large courses are not
-- truncated by the API's max_rows limit, and one call feeds a whole page.

-- Attendance rows for a course, with host accounts removed (host_names is
-- applied at query time so editing it is retroactive).
create or replace function public._course_attendance(p_course uuid)
returns table (
  session_id uuid, participant_id uuid, first_seen timestamptz, seconds_in_call int,
  started_at timestamptz, session_date date, duration_sec int
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.session_id, a.participant_id, a.first_seen, a.seconds_in_call,
         s.started_at, s.session_date, s.duration_sec
  from public.attendance a
  join public.sessions s on s.id = a.session_id
  join public.participants p on p.id = a.participant_id
  join public.courses c on c.id = s.course_id
  where s.course_id = p_course
    and p.name_key <> all(array(select public.name_key(h) from unnest(c.host_names) h))
    and not exists (
      select 1 from public.participant_aliases al
      where al.participant_id = p.id
        and al.alias_key = any(array(select public.name_key(h) from unnest(c.host_names) h))
    )
$$;

-- ---------------------------------------------------------------------------
-- Full dashboard payload for one course.
--   sessions:     per-session headcount, new vs returning, avg minutes
--   participants: per-person stats, streaks and segment
--   attendance:   compact matrix [session_id, participant_id, seconds, join_delay_sec]
-- p_min_minutes overrides the course's "present" threshold.
-- ---------------------------------------------------------------------------
create or replace function public.course_dashboard(
  p_course uuid,
  p_from date default null,
  p_to date default null,
  p_min_minutes int default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c     public.courses;
  v_min   int;
  v_res   jsonb;
begin
  perform public.assert_course_access(p_course);
  select * into v_c from public.courses where id = p_course;
  v_min := greatest(coalesce(p_min_minutes, v_c.min_present_minutes), 0) * 60;

  with
  s as (
    select se.*, row_number() over (order by se.started_at, se.seq) as idx
    from public.sessions se
    where se.course_id = p_course
      and (p_from is null or se.session_date >= p_from)
      and (p_to is null or se.session_date <= p_to)
  ),
  n as (
    select count(*)::int as total, coalesce(max(idx), 0) as max_idx, max(session_date) as last_date from s
  ),
  a_course as (select * from public._course_attendance(p_course)),
  -- first ever "present" session in the whole course (not just the range)
  first_ever as (
    select participant_id, min(started_at) as first_start, min(session_date) as first_date
    from a_course where seconds_in_call >= v_min group by participant_id
  ),
  a as (
    select ac.*, s.idx
    from a_course ac join s on s.id = ac.session_id
  ),
  pres as (select * from a where seconds_in_call >= v_min),
  isl as (
    select participant_id, idx, idx - row_number() over (partition by participant_id order by idx) as grp
    from pres
  ),
  runs as (
    select participant_id, count(*)::int as len, max(idx) as last_idx from isl group by participant_id, grp
  ),
  streaks as (
    select r.participant_id,
           max(r.len) as longest,
           coalesce(max(r.len) filter (where r.last_idx = (select max_idx from n)), 0) as current
    from runs r group by r.participant_id
  ),
  pstats as (
    select participant_id,
           count(*)::int as sessions_attended,
           sum(seconds_in_call)::bigint as total_seconds,
           round(avg(seconds_in_call))::int as avg_seconds,
           round(avg(least(seconds_in_call::numeric / nullif(duration_sec, 0), 1)) * 100, 1) as avg_pct_of_session,
           min(session_date) as first_date,
           max(session_date) as last_date,
           max(idx) as last_idx,
           round(avg(greatest(extract(epoch from (first_seen - started_at)), 0)))::int as avg_join_delay_sec
    from pres group by participant_id
  ),
  people as (
    select p.id, p.display_name, ps.*, st.longest, st.current, fe.first_date as first_ever_date,
           round(ps.sessions_attended * 100.0 / nullif((select total from n), 0), 1) as attendance_pct
    from pstats ps
    join public.participants p on p.id = ps.participant_id
    left join streaks st on st.participant_id = ps.participant_id
    left join first_ever fe on fe.participant_id = ps.participant_id
  ),
  ssum as (
    select s.id, s.session_date, s.seq, s.started_at, s.ended_at, s.duration_sec, s.meeting_code,
           count(pr.participant_id)::int as headcount,
           count(pr.participant_id) filter (where fe.first_start = s.started_at)::int as new_count,
           coalesce(round(avg(pr.seconds_in_call)), 0)::int as avg_seconds,
           count(pr.participant_id) filter (where pr.seconds_in_call >= 0.9 * s.duration_sec)::int as full_count,
           (select count(*) from a where a.session_id = s.id)::int as raw_count
    from s
    left join pres pr on pr.session_id = s.id
    left join first_ever fe on fe.participant_id = pr.participant_id
    group by s.id, s.session_date, s.seq, s.started_at, s.ended_at, s.duration_sec, s.meeting_code, s.idx
  )
  select jsonb_build_object(
    'course', to_jsonb(v_c),
    'min_minutes', v_min / 60,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'date', session_date, 'seq', seq, 'started_at', started_at, 'ended_at', ended_at,
        'duration_sec', duration_sec, 'meeting_code', meeting_code, 'headcount', headcount,
        'new_count', new_count, 'returning_count', headcount - new_count, 'avg_seconds', avg_seconds,
        'full_count', full_count, 'raw_count', raw_count
      ) order by started_at, seq) from ssum), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', display_name, 'sessions_attended', sessions_attended,
        'attendance_pct', attendance_pct, 'total_seconds', total_seconds, 'avg_seconds', avg_seconds,
        'avg_pct_of_session', avg_pct_of_session, 'first_date', first_date, 'last_date', last_date,
        'first_ever_date', first_ever_date, 'avg_join_delay_sec', avg_join_delay_sec,
        'longest_streak', coalesce(longest, 0), 'current_streak', coalesce(current, 0),
        'segment', case
          when first_ever_date >= (select last_date from n) - 14 then 'new'
          when attendance_pct >= v_c.regular_threshold_pct then 'regular'
          when last_idx <= (select max_idx from n) - 3 then 'lapsed'
          else 'occasional' end
      ) order by sessions_attended desc, total_seconds desc) from people), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(jsonb_build_array(
        session_id, participant_id, seconds_in_call,
        greatest(extract(epoch from (first_seen - started_at)), 0)::int
      )) from a), '[]'::jsonb)
  ) into v_res;

  return v_res;
end
$$;

-- ---------------------------------------------------------------------------
-- Course cards for the home page.
-- ---------------------------------------------------------------------------
create or replace function public.courses_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select * from public.courses where public.can_access_course(id)
  ),
  present as (
    select c.id as course_id, a.session_id, a.participant_id
    from c, lateral public._course_attendance(c.id) a
    where a.seconds_in_call >= c.min_present_minutes * 60
  ),
  per_session as (
    select s.course_id, s.id, s.session_date, s.started_at, count(pr.participant_id) as headcount
    from public.sessions s
    join c on c.id = s.course_id
    left join present pr on pr.session_id = s.id
    group by s.course_id, s.id, s.session_date, s.started_at
  ),
  uniq as (
    select course_id, count(distinct participant_id) as participants from present group by course_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'status', c.status,
    'schedule_note', c.schedule_note,
    'sessions', (select count(*) from per_session ps where ps.course_id = c.id),
    'participants', coalesce((select participants from uniq u where u.course_id = c.id), 0),
    'avg_headcount', (select round(avg(headcount), 1) from per_session ps where ps.course_id = c.id),
    'last_session_date', (select max(session_date) from per_session ps where ps.course_id = c.id),
    'spark', coalesce((select jsonb_agg(h order by started_at) from (
        select headcount as h, started_at from per_session ps where ps.course_id = c.id
        order by started_at desc limit 16) t), '[]'::jsonb)
  ) order by (c.status = 'archived'), c.name), '[]'::jsonb)
  from c
$$;

-- ---------------------------------------------------------------------------
-- Upload history for the Sessions page.
-- ---------------------------------------------------------------------------
create or replace function public.course_sessions(p_course uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_course_access(p_course);
  return coalesce((
    select jsonb_agg(public._session_json(s.id) order by s.started_at desc, s.seq desc)
    from public.sessions s where s.course_id = p_course
  ), '[]'::jsonb);
end
$$;

create or replace function public.course_upload_log(p_course uuid, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_course_access(p_course);
  return coalesce((
    select jsonb_agg(to_jsonb(l) order by l.at desc)
    from (select * from public.upload_log where course_id = p_course order by at desc limit least(greatest(p_limit, 1), 500)) l
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Participant directory (for merges) scoped to what the caller can see.
-- ---------------------------------------------------------------------------
create or replace function public.participant_directory(p_course uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_course is not null then perform public.assert_course_access(p_course); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.display_name, 'key', p.name_key, 'external_id', p.external_id,
      'aliases', coalesce((select jsonb_agg(al.alias_key order by al.alias_key) from public.participant_aliases al where al.participant_id = p.id), '[]'::jsonb),
      'sessions', x.sessions, 'last_date', x.last_date,
      'courses', x.courses
    ) order by p.display_name)
    from public.participants p
    join lateral (
      select count(*)::int as sessions, max(s.session_date) as last_date,
             jsonb_agg(distinct s.course_id) as courses
      from public.attendance a join public.sessions s on s.id = a.session_id
      where a.participant_id = p.id
        and public.can_access_course(s.course_id)
        and (p_course is null or s.course_id = p_course)
    ) x on x.sessions > 0
  ), '[]'::jsonb);
end
$$;

revoke execute on all functions in schema public from public;
grant execute on function
  public.course_dashboard(uuid, date, date, int), public.courses_overview(),
  public.course_sessions(uuid), public.course_upload_log(uuid, int), public.participant_directory(uuid)
to authenticated;
