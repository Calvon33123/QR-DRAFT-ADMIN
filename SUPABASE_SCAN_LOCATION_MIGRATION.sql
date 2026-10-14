-- QR scan location mapping migration
-- Run after MD/migration-smart-attendance.sql in Supabase SQL Editor.
-- Captures location at attendance submission only; no background tracking.

alter table public.attendance
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_verified boolean not null default false;

create index if not exists attendance_event_location_idx
  on public.attendance (event_id, scanned_at desc)
  where latitude is not null and longitude is not null;

alter table public.attendance enable row level security;

drop policy if exists "Admins can view attendance scan locations" on public.attendance;
create policy "Admins can view attendance scan locations"
  on public.attendance for select to authenticated
  using (public.is_admin());

drop policy if exists "Teachers can view locations for their events" on public.attendance;
create policy "Teachers can view locations for their events"
  on public.attendance for select to authenticated
  using (exists (
    select 1 from public.events e
    where e.id = attendance.event_id and e.created_by = auth.uid()
  ));

-- Existing student-own-row SELECT policy remains in place.
-- Do not add public SELECT policies or put the Supabase service-role key in the app.
