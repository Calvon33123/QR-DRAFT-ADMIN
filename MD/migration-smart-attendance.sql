-- Run this migration AFTER the existing schema.sql in Supabase SQL Editor.
-- Adds analytics dimensions and metadata for smart/offline attendance.

alter table public.profiles
  add column if not exists section text,
  add column if not exists program text;

alter table public.events
  add column if not exists late_after_minutes integer not null default 10,
  add column if not exists require_location boolean not null default false,
  add column if not exists allowed_latitude double precision,
  add column if not exists allowed_longitude double precision,
  add column if not exists allowed_radius_meters integer not null default 150;

alter table public.attendance
  add column if not exists attendance_status text not null default 'present'
    check (attendance_status in ('present', 'late')),
  add column if not exists attendance_method text not null default 'qr'
    check (attendance_method in ('qr', 'nfc', 'rfid', 'face', 'manual')),
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_verified boolean not null default false,
  add column if not exists client_record_id text unique,
  add column if not exists synced_at timestamptz not null default now();

create index if not exists attendance_event_scanned_idx
  on public.attendance (event_id, scanned_at);
create index if not exists profiles_section_program_idx
  on public.profiles (section, program);

-- Server-side attendance validation. Client-side checks are for user feedback only;
-- this function is the authoritative validation path for new versions of the app.
create or replace function public.record_attendance(
  p_event_code text,
  p_scanned_at timestamptz default now(),
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_client_record_id text default null,
  p_attendance_method text default 'qr'
)
returns table (attendance_id uuid, attendance_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_status text;
  v_distance double precision;
  v_radius integer;
  v_student_id uuid := auth.uid();
begin
  if v_student_id is null then
    raise exception using errcode = '42501', message = 'Sign in before recording attendance.';
  end if;
  if p_attendance_method not in ('qr', 'nfc', 'rfid', 'face', 'manual') then
    raise exception using errcode = '22023', message = 'Unsupported attendance method.';
  end if;
  if p_scanned_at is null or p_scanned_at > now() + interval '2 minutes' then
    raise exception using errcode = '22023', message = 'Invalid attendance timestamp.';
  end if;

  select * into v_event
  from public.events e
  where e.event_code = p_event_code;
  if not found then
    raise exception using errcode = '22023', message = 'Event was not found.';
  end if;
  if v_event.start_time is not null and p_scanned_at < v_event.start_time then
    raise exception using errcode = '22023', message = 'Attendance timestamp is before the event starts.';
  end if;
  if v_event.end_time is not null and p_scanned_at > v_event.end_time then
    raise exception using errcode = '22023', message = 'Attendance timestamp is after the event ends.';
  end if;

  if coalesce(v_event.require_location, false) then
    if p_latitude is null or p_longitude is null or v_event.allowed_latitude is null or v_event.allowed_longitude is null then
      raise exception using errcode = '22023', message = 'Location is required for this event.';
    end if;
    if abs(p_latitude) > 90 or abs(p_longitude) > 180 then
      raise exception using errcode = '22023', message = 'Invalid location coordinates.';
    end if;
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_latitude - v_event.allowed_latitude) / 2), 2) +
      cos(radians(v_event.allowed_latitude)) * cos(radians(p_latitude)) *
      power(sin(radians(p_longitude - v_event.allowed_longitude) / 2), 2)
    ));
    v_radius := greatest(coalesce(v_event.allowed_radius_meters, 150), 1);
    if v_distance > v_radius then
      raise exception using errcode = '22023', message = 'You are outside the allowed attendance area.';
    end if;
  end if;

  v_status := case
    when v_event.start_time is not null and p_scanned_at > v_event.start_time + make_interval(mins => greatest(coalesce(v_event.late_after_minutes, 10), 0)) then 'late'
    else 'present'
  end;

  insert into public.attendance (
    student_id, event_id, scanned_at, attendance_status, attendance_method,
    latitude, longitude, location_verified, client_record_id, synced_at
  ) values (
    v_student_id, v_event.id, p_scanned_at, v_status, p_attendance_method,
    p_latitude, p_longitude, coalesce(v_event.require_location, false), p_client_record_id, now()
  ) returning id into attendance_id;

  attendance_status := v_status;
  return next;
end;
$$;

revoke all on function public.record_attendance(text, timestamptz, double precision, double precision, text, text) from public;
grant execute on function public.record_attendance(text, timestamptz, double precision, double precision, text, text) to authenticated;

-- Admin support: the app's admin screen relies on these permissions and RPCs.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('student', 'teacher', 'admin'));

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Prevent a user from promoting their own profile through the normal profile update policy.
create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception using errcode = '42501', message = 'Only an administrator can change account roles.';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
before update of role on public.profiles
for each row execute procedure public.prevent_self_role_change();

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_logs enable row level security;
drop policy if exists "Admins can view audit logs" on public.admin_audit_logs;
create policy "Admins can view audit logs" on public.admin_audit_logs
for select to authenticated using (public.is_admin());

-- Admin-only read policies are required for the analytics and management dashboard.
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles" on public.profiles
for select to authenticated using (public.is_admin());
drop policy if exists "Admins can view all events" on public.events;
create policy "Admins can view all events" on public.events
for select to authenticated using (public.is_admin());
drop policy if exists "Admins can view all attendance" on public.attendance;
create policy "Admins can view all attendance" on public.attendance
for select to authenticated using (public.is_admin());

create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_role text;
  target_email text;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator permission required.';
  end if;
  if new_role not in ('student', 'teacher', 'admin') then
    raise exception using errcode = '22023', message = 'Invalid role.';
  end if;
  select role, email into old_role, target_email from public.profiles where id = target_user_id for update;
  if not found then raise exception using errcode = '22023', message = 'User profile not found.'; end if;
  update public.profiles set role = new_role, updated_at = now() where id = target_user_id;
  insert into public.admin_audit_logs(actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'user_role_changed', 'profile', target_user_id::text,
    jsonb_build_object('email', target_email, 'old_role', old_role, 'new_role', new_role));
end;
$$;

create or replace function public.admin_correct_attendance(target_attendance_id uuid, corrected_scanned_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_old_time timestamptz;
  v_student_id uuid;
  v_event_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Administrator permission required.';
  end if;
  if corrected_scanned_at is null then
    raise exception using errcode = '22023', message = 'A valid attendance timestamp is required.';
  end if;
  select a.scanned_at, a.student_id, a.event_id into v_old_time, v_student_id, v_event_id
  from public.attendance a where a.id = target_attendance_id for update;
  if not found then raise exception using errcode = '22023', message = 'Attendance record not found.'; end if;
  select * into v_event from public.events where id = v_event_id;
  v_status := case
    when v_event.start_time is not null and corrected_scanned_at > v_event.start_time + make_interval(mins => greatest(coalesce(v_event.late_after_minutes, 10), 0)) then 'late'
    else 'present'
  end;
  update public.attendance set scanned_at = corrected_scanned_at, attendance_status = v_status where id = target_attendance_id;
  insert into public.admin_audit_logs(actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'attendance_time_corrected', 'attendance', target_attendance_id::text,
    jsonb_build_object('student_id', v_student_id, 'event_id', v_event_id, 'old_time', v_old_time, 'new_time', corrected_scanned_at, 'status', v_status));
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public;
revoke all on function public.admin_correct_attendance(uuid, timestamptz) from public;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
grant execute on function public.admin_correct_attendance(uuid, timestamptz) to authenticated;
