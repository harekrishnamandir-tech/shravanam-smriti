-- Home-page analytics across every course the caller can access.
-- Returns compact rows the browser aggregates, so filtering by course or
-- period doesn't need another round trip:
--   sessions: [id, course_id, date, started_at, duration_sec, headcount, new_count, avg_seconds]
--   people:   [participant_id, course_id, sessions, seconds, last_date, first_date]
--             (first_date = first "present" session in that course, all time)
-- Each course's own present threshold and host accounts apply.
create or replace function public.overview_dashboard(
  p_from date default null,
  p_to date default null,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if public.current_role_name() is null then
    raise exception 'Not an admin' using errcode = '42501';
  end if;

  with
  c as (
    select * from public.courses
    where public.can_access_course(id) and (p_include_archived or status <> 'archived')
  ),
  pres as (
    select c.id as course_id, x.session_id, x.participant_id, x.seconds_in_call, x.started_at, x.session_date
    from c, lateral public._course_attendance(c.id) x
    where x.seconds_in_call >= c.min_present_minutes * 60
  ),
  first_ever as (
    select course_id, participant_id, min(started_at) as first_start, min(session_date) as first_date
    from pres group by course_id, participant_id
  ),
  s as (
    select se.* from public.sessions se join c on c.id = se.course_id
    where (p_from is null or se.session_date >= p_from) and (p_to is null or se.session_date <= p_to)
  ),
  pr as (select p.* from pres p join s on s.id = p.session_id),
  ssum as (
    select s.id, s.course_id, s.session_date, s.started_at, s.duration_sec,
           count(pr.participant_id)::int as headcount,
           count(pr.participant_id) filter (where fe.first_start = s.started_at)::int as new_count,
           coalesce(round(avg(pr.seconds_in_call)), 0)::int as avg_seconds
    from s
    left join pr on pr.session_id = s.id
    left join first_ever fe on fe.course_id = s.course_id and fe.participant_id = pr.participant_id
    group by s.id, s.course_id, s.session_date, s.started_at, s.duration_sec
  ),
  pc as (
    select participant_id, course_id, count(*)::int as sessions, sum(seconds_in_call)::bigint as seconds, max(session_date) as last_date
    from pr group by participant_id, course_id
  )
  select jsonb_build_object(
    'courses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'slug', slug, 'name', name, 'status', status, 'timezone', timezone,
        'regular_threshold_pct', regular_threshold_pct, 'min_present_minutes', min_present_minutes
      ) order by name) from c), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(jsonb_build_array(
        id, course_id, session_date, started_at, duration_sec, headcount, new_count, avg_seconds
      ) order by started_at) from ssum), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_array(
        pc.participant_id, pc.course_id, pc.sessions, pc.seconds, pc.last_date, fe.first_date
      )) from pc join first_ever fe using (participant_id, course_id)), '[]'::jsonb),
    'names', coalesce((select jsonb_object_agg(p.id, p.display_name)
      from public.participants p where p.id in (select participant_id from pc)), '{}'::jsonb)
  ) into v;

  return v;
end
$$;

revoke execute on function public.overview_dashboard(date, date, boolean) from public, anon;
grant execute on function public.overview_dashboard(date, date, boolean) to authenticated;
