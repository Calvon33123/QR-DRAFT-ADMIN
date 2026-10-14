import { supabase } from "./supabase";

export type Event = {
  eventId: string;   // the public event code (from the UI, e.g. EVT-2026-0002)
  title: string;
  start: string;
  end: string;
  requireLocation?: boolean;
  allowedLatitude?: number | null;
  allowedLongitude?: number | null;
  allowedRadiusMeters?: number;
};

export type CloudEvent = {
  id: string;
  event_code: string;
  title: string;
  start_time: string | null;
  end_time: string | null;
  created_by: string | null;
  created_at: string;
  late_after_minutes?: number;
  require_location?: boolean;
  allowed_latitude?: number | null;
  allowed_longitude?: number | null;
  allowed_radius_meters?: number;
};

export async function createEvent(
  event: Event
): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from('events').upsert(
    {
      event_code: event.eventId,
      title: event.title,
      start_time: event.start || null,
      end_time: event.end || null,
      created_by: user?.id ?? null,
      require_location: event.requireLocation ?? false,
      allowed_latitude: event.allowedLatitude ?? null,
      allowed_longitude: event.allowedLongitude ?? null,
      allowed_radius_meters: event.allowedRadiusMeters ?? 150,
    },
    { onConflict: 'event_code' }
  );

  return { error: error?.message ?? null };
}

export async function getEventsByTeacher(
  teacherId: string
): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as CloudEvent[];
}

export async function getEventByCode(
  code: string
): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_code', code)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CloudEvent;
}
