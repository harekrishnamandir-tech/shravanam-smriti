-- Courses (visible to the caller) that a devotee has attended, for the
-- cross-course devotee profile.
create or replace function public.participant_courses(p_participant uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.course_id), '{}')
  from public.attendance a
  join public.sessions s on s.id = a.session_id
  where a.participant_id = p_participant
    and public.can_access_course(s.course_id)
$$;

revoke execute on function public.participant_courses(uuid) from public, anon;
grant execute on function public.participant_courses(uuid) to authenticated;
