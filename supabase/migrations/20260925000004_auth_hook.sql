-- Optional hardening: reject sign-ups from emails that are not on the admin
-- list, so strangers never get an auth account at all. Enable it in the
-- dashboard: Authentication -> Hooks -> "Before User Created" ->
-- Postgres function public.hook_before_user_created.
-- (Without it, non-admins can sign in but RLS shows them nothing.)
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.admins where email = lower(event->'user'->>'email')) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'This email is not registered as an administrator.'
  ));
end
$$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
