
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { parseQRPayload } from './qr';
import { getEventByCode } from './events';
import { supabase } from './supabase';

// Pending records are local drafts until Supabase confirms them.
const PENDING_ATTENDANCE_KEY = '@qr-attendance/pending-v1';
type PendingAttendance = { key: string; rawPayload: string; studentId: string; queuedAt: string; latitude?: number; longitude?: number };

async function readPendingAttendance(): Promise<PendingAttendance[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(PENDING_ATTENDANCE_KEY)) ?? '[]');
  } catch {
    return [];
  }
}

async function writePendingAttendance(items: PendingAttendance[]) {
  await AsyncStorage.setItem(PENDING_ATTENDANCE_KEY, JSON.stringify(items));
}

export async function getPendingAttendanceCount(): Promise<number> {
  return (await readPendingAttendance()).length;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getDeviceCoordinates(): Promise<{ latitude: number; longitude: number }> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission is required for this event. Enable precise location and try again.');
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) throw new Error('Location services are turned off. Enable GPS/location services and try again.');

  // Ask the OS for a fresh high-accuracy fix rather than accepting a coarse cached estimate.
  const current = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
    mayShowUserSettingsDialog: true,
  });
  const { latitude, longitude, accuracy } = current.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('GPS did not return a valid location. Move to an open area and try again.');
  }
  // Poor fixes can wrongly place students on either side of a geofence. Ask them to retry instead.
  if (accuracy != null && accuracy > 50) {
    throw new Error(`GPS accuracy is currently about ${Math.round(accuracy)} m, which is too imprecise. Turn on Precise Location, move somewhere with a clearer sky view, and try again.`);
  }
  return { latitude, longitude };
}

function verifyCoordinates(
  latitude: number | undefined, longitude: number | undefined,
  event: { require_location?: boolean; allowed_latitude?: number | null; allowed_longitude?: number | null; allowed_radius_meters?: number }
): { ok: boolean; message?: string } {
  if (!event.require_location) return { ok: true };
  if (latitude == null || longitude == null || event.allowed_latitude == null || event.allowed_longitude == null) {
    return { ok: false, message: 'Location could not be verified. Ask the event organizer to check the event location settings.' };
  }
  const distance = distanceMeters(latitude, longitude, event.allowed_latitude, event.allowed_longitude);
  const radius = event.allowed_radius_meters ?? 150;
  if (distance > radius) return { ok: false, message: `You are outside the allowed attendance area (${Math.round(distance)} m away; limit ${radius} m).` };
  return { ok: true };
}

/** Upload queued scans when online. Server uniqueness makes retries safe. */
export async function syncPendingAttendance(): Promise<{ synced: number; pending: number; rejected: number }> {
  const pending = await readPendingAttendance();
  const remaining: PendingAttendance[] = [];
  let synced = 0;
  let rejected = 0;

  for (const item of pending) {
    try {
      const parsed = parseQRPayload(item.rawPayload);
      if (!parsed.ok) { rejected += 1; continue; }
      const payload = parsed.payload;
      const occurredAt = new Date(item.queuedAt).getTime();
      const effectiveTime = Number.isFinite(occurredAt) ? occurredAt : Date.now();
      const start = payload.start ? new Date(payload.start).getTime() : null;
      const end = payload.end ? new Date(payload.end).getTime() : null;
      if ((start !== null && effectiveTime < start) || (end !== null && effectiveTime > end)) {
        rejected += 1;
        continue;
      }

      const event = await getEventByCode(payload.event);
      if (!event) { remaining.push(item); continue; }
      const eventStart = event.start_time ? new Date(event.start_time).getTime() : null;
      const eventEnd = event.end_time ? new Date(event.end_time).getTime() : null;
      if ((eventStart !== null && effectiveTime < eventStart) || (eventEnd !== null && effectiveTime > eventEnd)) {
        rejected += 1;
        continue;
      }
      const location = verifyCoordinates(item.latitude, item.longitude, event);
      if (!location.ok) { rejected += 1; continue; }
      const { error } = await supabase.rpc('record_attendance', {
        p_event_code: payload.event,
        p_scanned_at: new Date(effectiveTime).toISOString(),
        p_latitude: item.latitude ?? null,
        p_longitude: item.longitude ?? null,
        p_client_record_id: item.key,
        p_attendance_method: 'qr',
      });
      if (!error || error.code === '23505') {
        if (!error) synced += 1;
        continue;
      }
      // Validation errors will never succeed on retry; remove them from the pending queue.
      if (error.code === '22023' || error.code === '42501') { rejected += 1; continue; }
      remaining.push(item);
    } catch {
      // Network/device failures leave the record queued for the next retry.
      remaining.push(item);
    }
  }
  await writePendingAttendance(remaining);
  return { synced, pending: remaining.length, rejected };
}

// Rejected attempts are stored separately so they remain visible to event staff
// without ever counting as valid attendance. The database re-checks the event radius.
async function logInvalidAttempt(eventCode: string, scannedAt: string, latitude?: number, longitude?: number, reason?: string) {
  try {
    await supabase.rpc('log_invalid_attendance_attempt', {
      p_event_code: eventCode,
      p_scanned_at: scannedAt,
      p_latitude: latitude ?? null,
      p_longitude: longitude ?? null,
      p_reason: reason ?? 'Attendance validation failed',
    });
  } catch {
    // A logging failure must never turn an invalid scan into valid attendance.
  }
}

// ============================================================
// REGISTER STUDENT ATTENDANCE
// ============================================================

export async function registerAttendance(
  rawPayload: string,
  studentId: string
): Promise<RegisterResult> {
  const parsed = parseQRPayload(rawPayload);
  if (!parsed.ok) return { success: false, message: parsed.message };
  const payload = parsed.payload;
  const now = Date.now();
  const start = payload.start ? new Date(payload.start).getTime() : null;
  const end = payload.end ? new Date(payload.end).getTime() : null;
  if (start !== null && now < start) return { success: false, message: 'Event has not started yet.' };
  if (end !== null && now > end) return { success: false, message: 'Event has already ended.' };

  let event = await getEventByCode(payload.event);
  let coordinates: { latitude: number; longitude: number } | undefined;
  // Capture a one-time GPS fix for every attendance submission, not background location.
  const locationRequired = Boolean(event?.require_location || payload.location?.required);
  { 
    try {
      coordinates = await getDeviceCoordinates();
    } catch (error) {
      if (locationRequired) return { success: false, message: error instanceof Error ? error.message : 'Location permission is required for this event.' };
      // Location is optional unless the event explicitly requires venue verification.
      coordinates = undefined;
    }
  }

  // Online event settings are authoritative. QR metadata allows location capture during an outage.
  if (event) {
    const check = verifyCoordinates(coordinates?.latitude, coordinates?.longitude, event);
    if (!check.ok) { await logInvalidAttempt(payload.event, new Date(now).toISOString(), coordinates?.latitude, coordinates?.longitude, check.message); return { success: false, message: check.message ?? 'Location verification failed.' }; }
    const eventStart = event.start_time ? new Date(event.start_time).getTime() : null;
    const eventEnd = event.end_time ? new Date(event.end_time).getTime() : null;
    if ((eventStart !== null && now < eventStart) || (eventEnd !== null && now > eventEnd)) {
      return { success: false, message: 'This event is not currently accepting attendance.' };
    }
    const recordId = `${studentId}:${event.id}:${now}`;
    const scannedAt = new Date(now).toISOString();
    const { error } = await supabase.rpc('record_attendance', {
      p_event_code: payload.event,
      p_scanned_at: scannedAt,
      p_latitude: coordinates?.latitude ?? null,
      p_longitude: coordinates?.longitude ?? null,
      p_client_record_id: recordId,
      p_attendance_method: 'qr',
    });
    if (error) {
      if (error.code === '23505') return { success: false, message: 'Already registered for this event.', eventTitle: event.title };
      if (error.code === '22023' || error.code === '42501') { await logInvalidAttempt(payload.event, scannedAt, coordinates?.latitude, coordinates?.longitude, error.message); return { success: false, message: error.message, eventTitle: event.title }; }
      // A network error should not lose the scan; keep the original scan time for late calculation.
      const pending = await readPendingAttendance();
      if (!pending.some((item) => item.studentId === studentId && item.key === recordId)) {
        pending.push({ key: recordId, rawPayload, studentId, queuedAt: scannedAt, latitude: coordinates?.latitude, longitude: coordinates?.longitude });
        await writePendingAttendance(pending);
      }
      return { success: true, message: 'Saved on this device. Attendance is pending server validation and will sync when connection returns.', eventTitle: event.title };
    }
    const lateAfter = event.late_after_minutes ?? 10;
    const attendanceStatus = eventStart !== null && now > eventStart + lateAfter * 60_000 ? 'late' : 'present';
    return { success: true, message: `Attendance recorded${attendanceStatus === 'late' ? ' (Late)' : ' (On time)'}.`, eventTitle: event.title };
  }

  // A location-required event cannot be marked pending while offline: its venue/radius
  // must be checked against authoritative event settings on the server before attendance counts.
  if (locationRequired) {
    return { success: false, message: 'Could not verify this event with the server. Connect to the internet and scan again so your location can be validated.' , eventTitle: payload.title ?? payload.event };
  }

  // No event response usually means offline. Non-location-required scans may be queued for later validation.
  const pending = await readPendingAttendance();
  const alreadyQueued = pending.some((item) => {
    if (item.studentId !== studentId) return false;
    const prior = parseQRPayload(item.rawPayload);
    return prior.ok && prior.payload.event === payload.event;
  });
  if (alreadyQueued) return { success: false, message: 'This attendance scan is already waiting to sync.', eventTitle: payload.title ?? payload.event };
  const key = `${studentId}:${payload.event}:${Date.now()}`;
  pending.push({ key, rawPayload, studentId, queuedAt: new Date().toISOString(), latitude: coordinates?.latitude, longitude: coordinates?.longitude });
  await writePendingAttendance(pending);
  return { success: true, message: 'Saved on this device. Attendance is pending server validation and will sync when connection returns.', eventTitle: payload.title ?? payload.event };
}

export type RegisterResult = {
  success: boolean;
  message: string;
  eventTitle?: string;
};

// ============================================================
// STUDENT ATTENDANCE HISTORY
// ============================================================

export type AttendanceRecord = {
  id: string;
  eventId: string;
  eventTitle: string;
  scannedAt: string;
};

export async function getAttendanceHistory(
  studentId: string
): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select('id, scanned_at, events(event_code, title)')
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });

  if (error) {
    console.error('Failed to load student history:', error);
    throw error;
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    eventId: row.events?.event_code ?? '',
    eventTitle: row.events?.title ?? 'Unknown event',
    scannedAt: row.scanned_at,
  }));
}

// ============================================================
// TEACHER EVENT HISTORY TYPES
// ============================================================

export type TeacherEventAttendance = {
  eventId: string;
  eventCode: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  attendeeCount: number;
  attendees: {
    studentId: string;
    scannedAt: string;
    studentName: string | null;
  }[];
};

export type TeacherEventSummary = {
  eventId: string;
  eventCode: string;
  title: string;
  attendeeCount: number;
};

// ============================================================
// TEACHER EVENT HISTORY
// Includes ALL events created by the teacher, even if
// nobody has scanned the QR code.
// ============================================================

export async function getTeacherEventAttendance(
  teacherId: string
): Promise<TeacherEventAttendance[]> {
  if (!teacherId) {
    throw new Error('Teacher ID is missing.');
  }

  // 1. Retrieve events owned by this teacher.
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, start_time, end_time, created_at')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError) {
    console.error('Failed to fetch teacher events:', eventError);
    throw eventError;
  }

  if (!events || events.length === 0) {
    console.log('No events found for teacher UUID:', teacherId);
    return [];
  }

  // 2. Retrieve attendance for the teacher's events.
  const eventIds = events.map((event) => event.id);

  const { data: attendance, error: attendanceError } = await supabase
    .from('attendance')
    .select('student_id, scanned_at, event_id')
    .in('event_id', eventIds)
    .order('scanned_at', { ascending: false });

  if (attendanceError) {
    console.error('Failed to fetch teacher attendance:', attendanceError);
    throw attendanceError;
  }

  const attendanceRows = attendance ?? [];

  // 3. Return every event, including events with zero attendees.
  return events.map((event) => {
    const rows = attendanceRows.filter(
      (record) => record.event_id === event.id
    );

    return {
      eventId: event.id,
      eventCode: event.event_code,
      title: event.title,
      startTime: event.start_time,
      endTime: event.end_time,
      attendeeCount: rows.length,
      attendees: rows.map((record) => ({
        studentId: record.student_id,
        scannedAt: record.scanned_at,
        studentName: null,
      })),
    };
  });
}

// ============================================================
// TEACHER EVENT SUMMARY
// ============================================================

export async function getTeacherEventSummary(
  teacherId: string
): Promise<TeacherEventSummary[]> {
  if (!teacherId) {
    throw new Error('Teacher ID is missing.');
  }

  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, created_at')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError) {
    console.error('Failed to load teacher event summary:', eventError);
    throw eventError;
  }

  if (!events || events.length === 0) {
    return [];
  }

  const eventIds = events.map((event) => event.id);

  const { data: attendance, error: attendanceError } = await supabase
    .from('attendance')
    .select('event_id')
    .in('event_id', eventIds);

  if (attendanceError) {
    console.error('Failed to count event attendance:', attendanceError);
    throw attendanceError;
  }

  const counts: Record<string, number> = {};

  for (const record of attendance ?? []) {
    counts[record.event_id] = (counts[record.event_id] ?? 0) + 1;
  }

  return events.map((event) => ({
    eventId: event.id,
    eventCode: event.event_code,
    title: event.title,
    attendeeCount: counts[event.id] ?? 0,
  }));
}
