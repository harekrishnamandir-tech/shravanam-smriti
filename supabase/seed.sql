-- Local development seed only (applied by `supabase db reset`, never pushed).
-- All names are synthetic.

insert into public.admins (email, role) values ('admin@example.com', 'super_admin'),
                                               ('guide@example.com', 'course_admin');

-- Demo sign-in accounts for local development only (password: hare-krishna).
-- Used by the dev-only "Quick sign-in" buttons; never present in production.
do $$
declare
  u record;
begin
  for u in select * from (values
    ('d0000000-0000-0000-0000-000000000001'::uuid, 'admin@example.com'),
    ('d0000000-0000-0000-0000-000000000002'::uuid, 'guide@example.com'),
    ('d0000000-0000-0000-0000-000000000003'::uuid, 'visitor@example.com')
  ) as t(id, email) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('hare-krishna', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', now(), now(), now());
  end loop;
end
$$;

insert into public.courses (id, slug, name, description, host_names, min_present_minutes, schedule_note, start_date)
values
  ('11111111-1111-1111-1111-111111111111', 'gita-daily', 'Bhagavad Gita Daily Reading',
   'A verse-by-verse reading of the Bhagavad Gita.', array['Host Desk'], 10, 'Daily, 8:30 PM', '2026-06-01'),
  ('22222222-2222-2222-2222-222222222222', 'bhagavatam-weekend', 'Srimad Bhagavatam Weekend',
   'Weekend study of the Srimad Bhagavatam.', array['Host Desk'], 15, 'Sat & Sun, 7:00 AM', '2026-06-06');

insert into public.course_admins (email, course_id) values ('guide@example.com', '22222222-2222-2222-2222-222222222222');
insert into public.course_meeting_codes (meeting_code, course_id) values
  ('abc-defg-hij', '11111111-1111-1111-1111-111111111111'),
  ('xyz-wxyz-xyz', '22222222-2222-2222-2222-222222222222');

do $$
declare
  v_names text[] := array[
    'Host Desk', 'Arjun Mehta', 'Radhika Iyer', 'Madhav Rao', 'Govind Patel', 'Keshav Nair', 'Lalita Sharma',
    'Vishakha Das', 'Gopal Verma', 'Damodar Joshi', 'Yashoda Kulkarni', 'Nanda Kishore', 'Mukund Reddy',
    'Shyam Sundar', 'Vrinda Menon', 'Balaram Singh', 'Subhadra Ghosh', 'Uddhav Pillai', 'Akrura Bose',
    'Sudama Mishra', 'Rukmini Bhat', 'Satyabhama Jain', 'Janaki Rao', 'Hari Prasad', 'Mohan Lal',
    'Kanhaiya Gupta', 'Murari Saxena', 'Achyut Desai', 'Ananta Shetty', 'Jagannath Sahu', 'Tulsi Agarwal',
    'Madhavi Rao'
  ];
  v_weight numeric[];
  v_course uuid;
  v_day date;
  v_start timestamp;
  v_slot time;
  v_len int;
  v_session uuid;
  v_pid uuid;
  i int;
  v_code text;
  v_tz text := 'Asia/Kolkata';
begin
  perform setseed(0.108);
  -- per-person attendance likelihood (host always present)
  v_weight := array[1.0];
  for i in 2..array_length(v_names, 1) loop
    v_weight := v_weight || round((0.15 + random() * 0.8)::numeric, 2);
  end loop;

  for i in 1..array_length(v_names, 1) loop
    insert into public.participants (display_name, name_key)
    values (v_names[i], public.name_key(v_names[i])) on conflict do nothing;
  end loop;

  for v_day in select d::date from generate_series(date '2026-06-01', date '2026-09-24', interval '1 day') d loop
    foreach v_course in array array['11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid] loop
      if v_course = '22222222-2222-2222-2222-222222222222' and extract(isodow from v_day) < 6 then continue; end if;
      if v_course = '11111111-1111-1111-1111-111111111111' and random() < 0.12 then continue; end if; -- skipped days
      v_code := case when v_course = '11111111-1111-1111-1111-111111111111' then 'abc-defg-hij' else 'xyz-wxyz-xyz' end;
      -- The Gita course also meets early on Sundays: two sessions that day.
      foreach v_slot in array case
          when v_code = 'xyz-wxyz-xyz' then array[time '07:00']
          when extract(isodow from v_day) = 7 then array[time '06:30', time '20:30']
          else array[time '20:30'] end loop
      v_start := v_day + v_slot + (floor(random() * 6) || ' minutes')::interval;
      v_len := 50 + floor(random() * 25)::int;
      insert into public.sessions (course_id, session_date, seq, meeting_code, started_at, ended_at, source_filename, uploaded_by_email)
      values (v_course, v_day, (select coalesce(max(seq), 0) + 1 from public.sessions where course_id = v_course and session_date = v_day),
              v_code, v_start at time zone v_tz, (v_start + (v_len || ' minutes')::interval) at time zone v_tz,
              'seed.csv', 'admin@example.com')
      returning id into v_session;

      for i in 1..array_length(v_names, 1) loop
        -- engagement drifts over the summer: some people fade, some join late
        -- demo outreach cases: one regular stops coming, one devotee joins recently
        if v_names[i] = 'Mohan Lal' and v_day > date '2026-09-05' then continue; end if;
        if v_names[i] = 'Madhavi Rao' and v_day < date '2026-09-16' then continue; end if;
        if random() < v_weight[i] * (case when i % 5 = 0 and v_day > date '2026-08-15' then 0.3
                                          when i % 7 = 0 and v_day < date '2026-07-15' then 0.1 else 1 end)
                                   * (case when v_slot = time '06:30' then 0.6 else 1 end) then
          select id into v_pid from public.participants where name_key = public.name_key(v_names[i]);
          insert into public.attendance (session_id, participant_id, first_seen, seconds_in_call)
          values (v_session, v_pid,
                  (v_start + (case when i = 1 then 0 else floor(random() * random() * 20 * 60) end || ' seconds')::interval) at time zone v_tz,
                  case when i = 1 then v_len * 60 else greatest(60, floor(v_len * 60 * (0.35 + random() * 0.65))::int) end);
        end if;
      end loop;
      end loop;
    end loop;
  end loop;
end
$$;
