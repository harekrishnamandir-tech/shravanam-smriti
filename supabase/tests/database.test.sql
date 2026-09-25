begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(33);

-- Users -----------------------------------------------------------------------
delete from auth.users where email like '%@example.com'; -- drop seeded demo logins
insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@example.com', now()),
  ('a0000000-0000-0000-0000-000000000002', 'guide@example.com', now()),
  ('a0000000-0000-0000-0000-000000000003', 'stranger@example.com', now()),
  ('a0000000-0000-0000-0000-000000000004', 'unverified@example.com', null);
insert into public.admins (email, role) values ('unverified@example.com', 'super_admin')
  on conflict (email) do update set role = excluded.role;

create function pg_temp.login(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- sign-up hook ------------------------------------------------------------------
select ok(public.hook_before_user_created('{"user":{"email":"stranger@example.com"}}') ? 'error', 'hook rejects non-admin sign-up');
select is(public.hook_before_user_created('{"user":{"email":"Admin@Example.com"}}'), '{}'::jsonb, 'hook allows admin email (case-insensitive)');

-- anon ------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from public.attendance $$, '42501', null, 'anon cannot read attendance');
select throws_ok($$ select public.me() $$, '42501', null, 'anon cannot call me()');
select throws_ok($$ select public.course_dashboard('11111111-1111-1111-1111-111111111111') $$, '42501', null, 'anon cannot call analytics');
select is(public.ping(), 'ok', 'anon can ping (keep-alive)');
reset role;

-- stranger (signed in, not an admin) --------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((select count(*) from public.courses)::int, 0, 'stranger sees no courses');
select is((select count(*) from public.attendance)::int, 0, 'stranger sees no attendance');
select is((select count(*) from public.participants)::int, 0, 'stranger sees no participants');
select is(public.me(), null, 'stranger me() is null');
select throws_ok($$ select public.course_dashboard('11111111-1111-1111-1111-111111111111') $$, '42501', null, 'stranger cannot load dashboard');
select throws_ok($$ insert into public.courses (slug, name) values ('x-course', 'X') $$, '42501', null, 'direct insert is denied');
reset role;

-- unverified email never gets admin rights -----------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000004');
set local role authenticated;
select is((select count(*) from public.courses)::int, 0, 'unverified email sees nothing despite admin row');
reset role;

-- course admin -------------------------------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*) from public.courses)::int, 1, 'course admin sees only assigned course');
select is((select count(*) from public.sessions where course_id = '11111111-1111-1111-1111-111111111111')::int, 0, 'course admin cannot see other course sessions');
select ok((select count(*) from public.sessions)::int > 0, 'course admin sees own sessions');
select throws_ok($$ select public.course_dashboard('11111111-1111-1111-1111-111111111111') $$, '42501', null, 'course admin blocked from other dashboard');
select lives_ok($$ select public.course_dashboard('22222222-2222-2222-2222-222222222222') $$, 'course admin loads own dashboard');
select throws_ok($$ select public.create_course('{"slug":"new-one","name":"New"}') $$, '42501', null, 'course admin cannot create courses');
select lives_ok($$ select public.update_course('22222222-2222-2222-2222-222222222222', '{"name":"Weekend Study"}') $$, 'course admin can edit own course');
select throws_ok($$ select public.update_course('11111111-1111-1111-1111-111111111111', '{"name":"Hijack"}') $$, '42501', null, 'course admin cannot edit other course');
reset role;

-- super admin: ingest / replace / delete -----------------------------------------------
select pg_temp.login('a0000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*) from public.courses)::int, 2, 'super admin sees all courses');

select is(public.ingest_session($j${
  "course_id": "11111111-1111-1111-1111-111111111111", "mode": "create",
  "meeting_code": "abc-defg-hij", "started_at": "2026-10-01 20:21:01", "ended_at": "2026-10-01 21:21:21",
  "rows": [
    {"name": "Host Desk", "first_seen": "2026-10-01 20:21:01", "seconds": 3619},
    {"name": "Arjun Mehta", "first_seen": "2026-10-01 20:30:00", "seconds": 1800},
    {"name": "ARJUN  mehta", "first_seen": "2026-10-01 20:25:00", "seconds": 600},
    {"name": "Brand New Person", "first_seen": "2026-10-01 20:40:00", "seconds": 1200}
  ]}$j$)->>'status', 'ok', 'ingest creates a session');

select is((select count(*) from public.attendance a join public.sessions s on s.id = a.session_id
           where s.session_date = '2026-10-01' and s.course_id = '11111111-1111-1111-1111-111111111111')::int,
          3, 'rejoins/case variants aggregate to one row per person');
select is((select seconds_in_call from public.attendance a join public.sessions s on s.id = a.session_id
           join public.participants p on p.id = a.participant_id
           where s.session_date = '2026-10-01' and p.name_key = 'arjun mehta'), 2400, 'rejoin seconds are summed');

select is(public.ingest_session($j${
  "course_id": "11111111-1111-1111-1111-111111111111", "mode": "create",
  "started_at": "2026-10-01 20:21:01", "ended_at": "2026-10-01 21:21:21",
  "rows": [{"name": "Arjun Mehta", "first_seen": "2026-10-01 20:30:00", "seconds": 60}]}$j$)->>'status',
  'exists', 'second create for the same date reports existing session');

create temp table t_before as
  select id from public.sessions where session_date = '2026-10-01' and course_id = '11111111-1111-1111-1111-111111111111';
select is((public.ingest_session($j${
  "course_id": "11111111-1111-1111-1111-111111111111", "mode": "replace",
  "started_at": "2026-10-01 20:21:01", "ended_at": "2026-10-01 21:21:21",
  "rows": [{"name": "Arjun Mehta", "first_seen": "2026-10-01 20:30:00", "seconds": 60}]}$j$)->'session'->>'id')::uuid,
  (select id from t_before), 'replace keeps the session id');
select is((select count(*) from public.participants where name_key = 'brand new person')::int, 0,
  'replace garbage-collects participants left without attendance');

select is((select count(*) from jsonb_array_elements(public.course_dashboard('11111111-1111-1111-1111-111111111111')->'participants') p
           where p->>'name' = 'Host Desk')::int, 0, 'host accounts are excluded from stats');

select lives_ok($$ select public.delete_session((select id from t_before)) $$, 'delete_session works');
select is((select count(*) from public.sessions where session_date = '2026-10-01' and course_id = '11111111-1111-1111-1111-111111111111')::int,
  0, 'session is gone after delete');

-- streak math on a controlled course -------------------------------------------------
select public.create_course('{"slug":"streak-test","name":"Streak Test","min_present_minutes":1}');
create temp table t_c as select id from public.courses where slug = 'streak-test';
do $$
declare d int; v_c uuid := (select id from t_c);
begin
  for d in 1..5 loop
    perform public.ingest_session(jsonb_build_object(
      'course_id', v_c, 'mode', 'create',
      'started_at', format('2026-11-0%s 08:00:00', d), 'ended_at', format('2026-11-0%s 09:00:00', d),
      'rows', (select jsonb_agg(jsonb_build_object('name', n, 'first_seen', format('2026-11-0%s 08:05:00', d), 'seconds', 1800))
               from unnest(case d when 1 then array['Streak A','Streak B']
                                  when 2 then array['Streak A','Streak B']
                                  when 3 then array['Streak B']
                                  else array['Streak A'] end) n)));
  end loop;
end $$;
create temp table t_dash as select public.course_dashboard((select id from t_c)) as j;
select is((select jsonb_build_array((p->>'longest_streak')::int, (p->>'current_streak')::int)
           from t_dash, jsonb_array_elements(j->'participants') p where p->>'name' = 'Streak A'),
          '[2,2]'::jsonb, 'A: attended 1,2,4,5 -> longest 2, current 2');
select is((select jsonb_build_array((p->>'longest_streak')::int, (p->>'current_streak')::int)
           from t_dash, jsonb_array_elements(j->'participants') p where p->>'name' = 'Streak B'),
          '[3,0]'::jsonb, 'B: attended 1,2,3 -> longest 3, current 0');
reset role;

select * from finish();
rollback;
