-- QR Attendance: safe student/teacher role choice at public registration.
-- Run in Supabase SQL Editor after the existing schema/smart-attendance migration.
-- Public signup may request only student or teacher; admin can only be assigned through admin_set_user_role.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
begin
  requested_role := coalesce(new.raw_user_meta_data ->> 'requested_role', 'student');
  if requested_role not in ('student', 'teacher') then
    requested_role := 'student';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    requested_role
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
-- Trigger execution does not require granting direct execute to clients.

-- Explicitly prevent public profile inserts from selecting elevated roles.
-- Existing role-protection trigger remains in place; only admin RPC can promote accounts to admin.
