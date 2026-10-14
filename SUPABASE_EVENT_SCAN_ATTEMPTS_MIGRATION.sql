-- Per-event scan attempts, including invalid/out-of-radius attempts.
-- Run AFTER MD/migration-smart-attendance.sql and SUPABASE_SCAN_LOCATION_MIGRATION.sql.
create table if not exists public.attendance_scan_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  scanned_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  distance_meters double precision,
  allowed_radius_meters integer,
  result text not null default 'invalid' check (result in ('invalid')),
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists attendance_scan_attempts_event_time_idx
  on public.attendance_scan_attempts(event_id, scanned_at desc);
create index if not exists attendance_scan_attempts_student_idx
  on public.attendance_scan_attempts(student_id, scanned_at desc);
-- Keep only the most recent rejected attempt per student/event.
with ranked as (
  select id, row_number() over (partition by event_id, student_id order by scanned_at desc, created_at desc) as rn
  from public.attendance_scan_attempts
) delete from public.attendance_scan_attempts a using ranked r where a.id = r.id and r.rn > 1;
create unique index if not exists attendance_scan_attempts_one_per_student_event_idx
  on public.attendance_scan_attempts(event_id, student_id);
alter table public.attendance_scan_attempts enable row level security;
drop policy if exists "Admins can view scan attempts" on public.attendance_scan_attempts;
create policy "Admins can view scan attempts" on public.attendance_scan_attempts
  for select to authenticated using (public.is_admin());
drop policy if exists "Event creators can view scan attempts" on public.attendance_scan_attempts;
create policy "Event creators can view scan attempts" on public.attendance_scan_attempts
  for select to authenticated using (exists (
    select 1 from public.events e where e.id = attendance_scan_attempts.event_id and e.created_by = auth.uid()
  ));
drop policy if exists "Students can view their own scan attempts" on public.attendance_scan_attempts;
create policy "Students can view their own scan attempts" on public.attendance_scan_attempts
  for select to authenticated using (student_id = auth.uid());

-- Students can log only their own rejected attempt. Event radius and ownership are resolved server-side.
create or replace function public.log_invalid_attendance_attempt(
  p_event_code text,
  p_scanned_at timestamptz default now(),
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_reason text default 'Attendance validation failed'
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_distance double precision := null;
  v_radius integer;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'Attendance validation failed'), 250);
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sign in required.'; end if;
  select * into v_event from public.events where event_code = p_event_code;
  if not found then raise exception using errcode = '22023', message = 'Event was not found.'; end if;
  v_radius := greatest(coalesce(v_event.allowed_radius_meters, 150), 1);
  if p_latitude is not null and p_longitude is not null
     and abs(p_latitude) <= 90 and abs(p_longitude) <= 180
     and v_event.allowed_latitude is not null and v_event.allowed_longitude is not null then
    v_distance := 6371000 * 2 * asin(sqrt(
      power(sin(radians(p_latitude - v_event.allowed_latitude) / 2), 2) +
      cos(radians(v_event.allowed_latitude)) * cos(radians(p_latitude)) *
      power(sin(radians(p_longitude - v_event.allowed_longitude) / 2), 2)
    ));
    if not coalesce(v_event.require_location, false) or v_distance <= v_radius then
      -- Do not log an invalid attempt when the server-side event/radius check passes.
      return;
    end if;
    v_reason := 'Outside allowed radius';
  elsif coalesce(v_event.require_location, false) then
    v_reason := 'Location unavailable or invalid';
  else
    return;
  end if;
  insert into public.attendance_scan_attempts(event_id, student_id, scanned_at, latitude, longitude, distance_meters, allowed_radius_meters, reason)
  values (v_event.id, auth.uid(), coalesce(p_scanned_at, now()), p_latitude, p_longitude, v_distance, v_radius, v_reason)
  on conflict (event_id, student_id) do update set
    scanned_at = excluded.scanned_at, latitude = excluded.latitude, longitude = excluded.longitude,
    distance_meters = excluded.distance_meters, allowed_radius_meters = excluded.allowed_radius_meters,
    reason = excluded.reason;
end;
$$;
revoke all on function public.log_invalid_attendance_attempt(text, timestamptz, double precision, double precision, text) from public;
grant execute on function public.log_invalid_attendance_attempt(text, timestamptz, double precision, double precision, text) to authenticated;

-- Teachers may see the names of students whose rejected attempts belong to their events.
drop policy if exists "Teachers can view profiles of students with scan attempts" on public.profiles;
create policy "Teachers can view profiles of students with scan attempts" on public.profiles
  for select to authenticated using (exists (
    select 1 from public.attendance_scan_attempts a
    join public.events e on e.id = a.event_id
    where a.student_id = profiles.id and e.created_by = auth.uid()
  ));
