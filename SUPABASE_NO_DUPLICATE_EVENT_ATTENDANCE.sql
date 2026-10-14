-- Prevent a student from appearing as both accepted and invalid for the same event.
-- Run after MD/migration-smart-attendance.sql and SUPABASE_EVENT_SCAN_ATTEMPTS_MIGRATION.sql.
-- The attendance table already has UNIQUE(student_id, event_id); this migration
-- also cleans old duplicates and removes rejected attempts once attendance is accepted.

-- Clean up any historical duplicate accepted rows if a legacy schema lacked uniqueness.
with ranked as (
  select id, row_number() over (partition by event_id, student_id order by scanned_at asc, id asc) as rn
  from public.attendance
)
delete from public.attendance a using ranked r where a.id = r.id and r.rn > 1;

-- Accepted attendance takes precedence over previous rejected attempts.
delete from public.attendance_scan_attempts a
using public.attendance valid
where a.event_id = valid.event_id and a.student_id = valid.student_id;

-- Rejected attempts are unique per student per event (the latest attempt is retained).
with ranked as (
  select id, row_number() over (partition by event_id, student_id order by scanned_at desc, created_at desc) as rn
  from public.attendance_scan_attempts
)
delete from public.attendance_scan_attempts a using ranked r where a.id = r.id and r.rn > 1;
create unique index if not exists attendance_scan_attempts_one_per_student_event_idx
  on public.attendance_scan_attempts(event_id, student_id);

create or replace function public.remove_invalid_attempt_after_acceptance()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  delete from public.attendance_scan_attempts
  where event_id = new.event_id and student_id = new.student_id;
  return new;
end;
$$;
drop trigger if exists attendance_removes_invalid_attempt on public.attendance;
create trigger attendance_removes_invalid_attempt
after insert on public.attendance
for each row execute function public.remove_invalid_attempt_after_acceptance();
