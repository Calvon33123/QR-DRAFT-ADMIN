
import { useCallback, useState } from 'react';
import {
Alert,
FlatList,
Pressable,
ScrollView,
StyleSheet,
Text,
TextInput,
View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import MapView, { Circle, Marker, type MapPressEvent, type Region } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';
import AttendanceLocationMap, { type AttendanceLocationPoint } from '@/components/AttendanceLocationMap';
import { createEvent } from '@/lib/events';
import { buildQRPayload } from '@/lib/qr';
import QRCode from 'react-native-qrcode-svg';
type Section = 'overview' | 'users' | 'events' | 'attendance' | 'logs';
type ProfileRow = {
id: string;
email: string;
full_name: string | null;
section?: string | null;
program?: string | null;
role: Role;
};
type EventRow = {
id: string;
event_code: string;
title: string;
start_time: string | null;
end_time: string | null;
created_by: string | null;
late_after_minutes?: number;
require_location?: boolean;
allowed_latitude?: number | null;
allowed_longitude?: number | null;
allowed_radius_meters?: number | null;
};
type AttendanceRow = {
id: string;
student_id: string;
event_id: string;
scanned_at: string;
attendance_status?: 'present' | 'late';
latitude: number | null;
longitude: number | null;
};
type ScanAttemptRow = { id: string; student_id: string; event_id: string; scanned_at: string; latitude: number | null; longitude: number | null; distance_meters: number | null; allowed_radius_meters: number | null; reason: string };
type LogRow = {
id: number;
action: string;
target_type: string;
target_id: string | null;
details: Record<string, unknown>;
created_at: string;
};
const SECTIONS: { key: Section; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
{ key: 'overview', label: 'Overview', icon: 'grid-outline' },
{ key: 'users', label: 'Users', icon: 'people-outline' },
{ key: 'events', label: 'Events', icon: 'calendar-outline' },
{ key: 'attendance', label: 'Attendance', icon: 'checkmark-circle-outline' },
{ key: 'logs', label: 'Logs', icon: 'document-text-outline' },
];
export default function AdminScreen() {
const { user } = useAuth();
const [section, setSection] = useState<Section>('overview');
const [role, setRole] = useState<Role | null>(null);
const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [error, setError] = useState('');
const [profiles, setProfiles] = useState<ProfileRow[]>([]);
const [events, setEvents] = useState<EventRow[]>([]);
const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
const [scanAttempts, setScanAttempts] = useState<ScanAttemptRow[]>([]);
const [selectedAttendanceEventId, setSelectedAttendanceEventId] = useState<string | null>(null);
const [logs, setLogs] = useState<LogRow[]>([]);
const [filter, setFilter] = useState('');
const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
const [editingAttendanceId, setEditingAttendanceId] = useState<string | null>(null);
const [newEventTitle, setNewEventTitle] = useState('');
const [newEventCode, setNewEventCode] = useState('');
const [newEventRequiresLocation, setNewEventRequiresLocation] = useState(true);
const [newEventLatitude, setNewEventLatitude] = useState('');
const [newEventLongitude, setNewEventLongitude] = useState('');
const [newEventRadius, setNewEventRadius] = useState('150');
const [newEventMapRegion, setNewEventMapRegion] = useState<Region>({ latitude: 10.3157, longitude: 123.8854, latitudeDelta: 0.035, longitudeDelta: 0.035 });
const [eventCreateBusy, setEventCreateBusy] = useState(false);
const [createdEventQr, setCreatedEventQr] = useState<string | null>(null);
const [expandedEventStudentId, setExpandedEventStudentId] = useState<string | null>(null);
const [eventStudentSearch, setEventStudentSearch] = useState('');
const loadDashboard = useCallback(async () => {
if (!user) {
setRole(null);
setLoading(false);
return;
}
setRefreshing(true);
setError('');
try {
const currentProfile = await getProfile(user.id);
const currentRole = currentProfile?.role ?? null;
setRole(currentRole);
if (currentRole !== 'admin') {
setProfiles([]);
setEvents([]);
setAttendance([]);
setScanAttempts([]);
setLogs([]);
return;
}
const [
profileResult,
eventResult,
attendanceResult,
logResult,
attemptResult,
] = await Promise.all([
supabase
.from('profiles')
.select('id, email, full_name, role, section, program')
.order('created_at', { ascending: false }),
supabase
.from('events')
.select('id, event_code, title, start_time, end_time, created_by, late_after_minutes, allowed_latitude, allowed_longitude, allowed_radius_meters, require_location')
.order('created_at', { ascending: false }),
supabase
.from('attendance')
.select('id, student_id, event_id, scanned_at, attendance_status, latitude, longitude')
.order('scanned_at', { ascending: false }),
supabase
.from('admin_audit_logs')
.select('id, action, target_type, target_id, details, created_at')
.order('created_at', { ascending: false })
.limit(100),
supabase.from('attendance_scan_attempts').select('id, student_id, event_id, scanned_at, latitude, longitude, distance_meters, allowed_radius_meters, reason').order('scanned_at', { ascending: false }),
]);
const failed = [
profileResult.error,
eventResult.error,
attendanceResult.error,
logResult.error,
attemptResult.error,
].filter(Boolean);
if (failed.length) {
throw new Error(failed.map((item) => item!.message).join('\n'));
}
setProfiles((profileResult.data ?? []) as ProfileRow[]);
setEvents((eventResult.data ?? []) as EventRow[]);
setAttendance((attendanceResult.data ?? []) as AttendanceRow[]);
setScanAttempts((attemptResult.data ?? []) as ScanAttemptRow[]);
setSelectedAttendanceEventId((current) => current && (eventResult.data ?? []).some((e: any) => e.id === current) ? current : (eventResult.data ?? [])[0]?.id ?? null);
setLogs((logResult.data ?? []) as LogRow[]);
} catch (err) {
setError(err instanceof Error ? err.message : 'Could not load dashboard.');
} finally {
setLoading(false);
setRefreshing(false);
}
}, [user]);
useFocusEffect(
useCallback(() => {
void loadDashboard();
}, [loadDashboard])
);
const changeRole = (profile: ProfileRow) => {
const roles: Role[] = ['student', 'teacher', 'admin'];
Alert.alert(
'Change user role',
`${profile.email}\nCurrent role: ${profile.role}`,
[
{ text: 'Cancel', style: 'cancel' },
...roles
.filter((item) => item !== profile.role)
.map((nextRole) => ({
text: `Make ${nextRole}`,
onPress: () => {
Alert.alert(
'Confirm role change',
`Change ${profile.email} to ${nextRole}?`,
[
{ text: 'Cancel', style: 'cancel' },
{
text: 'Confirm',
onPress: async () => {
const { error: updateError } = await supabase.rpc(
'admin_set_user_role',
{
target_user_id: profile.id,
new_role: nextRole,
}
);
if (updateError) {
Alert.alert('Could not change role', updateError.message);
return;
}
await loadDashboard();
},
},
]
);
},
})),
]
);
};
const setAdminVenueFromMap = (event: MapPressEvent) => {
  const { latitude, longitude } = event.nativeEvent.coordinate;
  setNewEventLatitude(String(latitude)); setNewEventLongitude(String(longitude));
  setNewEventMapRegion((current) => ({ ...current, latitude, longitude, latitudeDelta: Math.min(current.latitudeDelta, 0.025), longitudeDelta: Math.min(current.longitudeDelta, 0.025) }));
};
const createAdminEvent = async () => {
  if (!newEventTitle.trim() || !newEventCode.trim()) { Alert.alert('Missing details', 'Enter an event title and event code.'); return; }
  const latitude = Number(newEventLatitude); const longitude = Number(newEventLongitude); const radius = Number(newEventRadius);
  if (newEventRequiresLocation && (!newEventLatitude.trim() || !newEventLongitude.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(radius) || radius < 25 || radius > 5000)) { Alert.alert('Check event location', 'Enter valid venue coordinates and a radius from 25 to 5000 meters, or turn off location verification.'); return; }
  setEventCreateBusy(true);
  const eventCode = newEventCode.trim().toUpperCase();
  const { data: duplicate, error: duplicateCheckError } = await supabase.from('events').select('id').eq('event_code', eventCode).maybeSingle();
  if (duplicateCheckError) { setEventCreateBusy(false); Alert.alert('Could not check event code', duplicateCheckError.message); return; }
  if (duplicate) { setEventCreateBusy(false); Alert.alert('Event code already exists', 'Choose a unique event code so an existing event is not overwritten.'); return; }
  const start = new Date(); const end = new Date(start.getTime() + 60 * 60 * 1000);
  const eventTitleValue = newEventTitle.trim();
  const startIso = start.toISOString(); const endIso = end.toISOString();
  let result: { error: string | null };
  try {
    result = await createEvent({ eventId: eventCode, title: eventTitleValue, start: startIso, end: endIso, requireLocation: newEventRequiresLocation, allowedLatitude: newEventRequiresLocation ? latitude : null, allowedLongitude: newEventRequiresLocation ? longitude : null, allowedRadiusMeters: radius || 150 });
  } catch (error) {
    setEventCreateBusy(false);
    Alert.alert('Could not create event', error instanceof Error ? error.message : 'Please try again.');
    return;
  }
  setEventCreateBusy(false);
  if (result.error) { Alert.alert('Could not create event', result.error); return; }
  // Keep event creation visible in the administrator's History/Logs section.
  const { error: auditError } = await supabase.from('admin_audit_logs').insert({
    action: 'event_created',
    target_type: 'event',
    target_id: eventCode,
    details: { title: eventTitleValue, event_code: eventCode, require_location: newEventRequiresLocation, allowed_latitude: newEventRequiresLocation ? latitude : null, allowed_longitude: newEventRequiresLocation ? longitude : null, allowed_radius_meters: newEventRequiresLocation ? (radius || 150) : null },
  });
  if (auditError) console.warn('Event was created, but its audit log could not be saved:', auditError.message);
  setCreatedEventQr(buildQRPayload({ eventId: eventCode, title: eventTitleValue, start: startIso, end: endIso, location: newEventRequiresLocation ? { required: true, latitude, longitude, radiusMeters: radius || 150 } : { required: false } }));
  setNewEventTitle(''); setNewEventCode(''); setSection('events');
  Alert.alert('Event created', 'Event saved. Its default time window is one hour from now. The QR code is shown below the form.');
  await loadDashboard();
};
const deleteEvent = (event: EventRow) => {
Alert.alert(
'Delete event?',
`Delete "${event.title}" and its linked attendance records? This cannot be undone.`,
[
{ text: 'Cancel', style: 'cancel' },
{
text: 'Delete',
style: 'destructive',
onPress: async () => {
const { error: deleteError } = await supabase
.from('events')
.delete()
.eq('id', event.id);
if (deleteError) {
Alert.alert('Could not delete event', deleteError.message);
return;
}
await loadDashboard();
},
},
]
);
};
const [correctedTime, setCorrectedTime] = useState('');
const saveAttendanceTime = async (record: AttendanceRow) => {
const parsed = new Date(correctedTime);
if (!correctedTime.trim() || Number.isNaN(parsed.getTime())) {
Alert.alert('Invalid date', 'Enter a valid ISO date/time.');
return;
}
const { error: updateError } = await supabase.rpc('admin_correct_attendance', {
  target_attendance_id: record.id,
  corrected_scanned_at: parsed.toISOString(),
});
if (updateError) {
Alert.alert('Could not correct attendance', updateError.message);
return;
}
setEditingAttendanceId(null);
setCorrectedTime('');
await loadDashboard();
};
if (loading) {
return (
<View style={styles.center}>
<Text style={styles.muted}>Loading admin dashboard...</Text>
</View>
);
}
if (role !== 'admin') {
return (
<View style={styles.center}>
<Ionicons name="lock-closed-outline" size={44} color={COLORS.danger} />
<Text style={styles.heading}>Admins only</Text>
<Text style={styles.muted}>
Your account does not have permission to view this dashboard.
</Text>
</View>
);
}
// Define these lookup helpers before filtering attendance, because filter() runs immediately.
const eventTitle = (id: string) =>
  events.find((event) => event.id === id)?.title ?? id.slice(0, 8);
const userEmail = (id: string) =>
  profiles.find((profile) => profile.id === id)?.email ?? id.slice(0, 8);

const visibleProfiles = profiles.filter((item) =>
  `${item.email} ${item.full_name ?? ''} ${item.role}`
    .toLowerCase()
    .includes(filter.toLowerCase())
);
const visibleEvents = events.filter((item) =>
  `${item.title} ${item.event_code}`.toLowerCase().includes(filter.toLowerCase())
);
const visibleAttendance = attendance.filter((item) =>
  `${item.student_id} ${item.event_id} ${item.scanned_at} ${userEmail(item.student_id)} ${eventTitle(item.event_id)}`
    .toLowerCase()
    .includes(filter.toLowerCase())
);
const students = profiles.filter((profile) => profile.role === 'student');
const attendanceOpportunities = students.length * events.length;
const attendanceRate = attendanceOpportunities
  ? Math.min(100, Math.round((attendance.length / attendanceOpportunities) * 100))
  : 0;
const isLate = (record: AttendanceRow) => {
  const event = events.find((item) => item.id === record.event_id);
  if (!event?.start_time) return false;
  if (record.attendance_status) return record.attendance_status === 'late';
  return new Date(record.scanned_at).getTime() > new Date(event.start_time).getTime() + (event.late_after_minutes ?? 10) * 60_000;
};
const lateCount = attendance.filter(isLate).length;
const attendanceByProfileField = (field: 'section' | 'program') => {
  const counts = new Map<string, number>();
  attendance.forEach((record) => {
    const profile = profiles.find((item) => item.id === record.student_id);
    const key = profile?.[field]?.trim() || 'Not specified';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
const topEvents = events.map((event) => ({
  ...event,
  count: attendance.filter((record) => record.event_id === event.id).length,
})).sort((a, b) => b.count - a.count).slice(0, 5);
return (
<View style={styles.container}>
<View style={styles.top}>
<Text style={styles.heading}>Admin Dashboard</Text>
<Text style={styles.muted}>QR Attendance · System management</Text>
</View>
<ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.navScroll}
        contentContainerStyle={styles.nav}
        keyboardShouldPersistTaps="handled"
      >
        {SECTIONS.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => {
              setSection(item.key);
              setFilter('');
              setCorrectedTime('');
            }}
            style={[styles.navItem, section === item.key && styles.navActive]}
          >
            <Ionicons
              name={item.icon}
              size={18}
              color={section === item.key ? COLORS.textPrimary : COLORS.textSecondary}
            />
            <Text style={styles.navText} numberOfLines={1}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
<ScrollView
  style={styles.adminContentScroll}
  contentContainerStyle={styles.adminContentContainer}
  showsVerticalScrollIndicator
  keyboardShouldPersistTaps="handled"
  nestedScrollEnabled
>
{error ? (
<View style={styles.errorBox}>
<Text style={styles.errorText}>{error}</Text>
</View>
) : null}
{['users', 'events', 'attendance'].includes(section) && (
<TextInput
value={filter}
onChangeText={setFilter}
placeholder="Search..."
placeholderTextColor={COLORS.textSecondary}
style={styles.search}
autoCapitalize="none"
/>
)}
{section === 'events' && <View style={styles.card}>
<Text style={styles.cardTitle}>Create an event</Text>
<Text style={styles.muted}>Create events directly from the Admin panel. New events use a one-hour time window starting now.</Text>
<Text style={styles.formLabel}>Event title</Text><TextInput value={newEventTitle} onChangeText={setNewEventTitle} placeholder="e.g. Science Fair" placeholderTextColor={COLORS.textSecondary} style={styles.formInput} />
<Text style={styles.formLabel}>Event code</Text><TextInput value={newEventCode} onChangeText={setNewEventCode} placeholder="e.g. EVT-2026-0010" placeholderTextColor={COLORS.textSecondary} autoCapitalize="characters" style={styles.formInput} />
<Pressable style={styles.toggleRow} onPress={() => setNewEventRequiresLocation((value) => !value)}><Ionicons name={newEventRequiresLocation ? 'checkbox' : 'square-outline'} size={22} color={COLORS.primary} /><Text style={styles.navText}>Require scan within event radius</Text></Pressable>
{newEventRequiresLocation && <><Text style={styles.formLabel}>Tap the map to set this event's venue</Text><View style={styles.adminVenueMapWrap}><MapView style={styles.adminVenueMap} region={newEventMapRegion} onPress={setAdminVenueFromMap}><Circle center={{ latitude: Number(newEventLatitude) || newEventMapRegion.latitude, longitude: Number(newEventLongitude) || newEventMapRegion.longitude }} radius={Math.max(25, Number(newEventRadius) || 150)} strokeColor="#2878D0" fillColor="rgba(40,120,208,0.12)" strokeWidth={2} /><Marker coordinate={{ latitude: Number(newEventLatitude) || newEventMapRegion.latitude, longitude: Number(newEventLongitude) || newEventMapRegion.longitude }} title="Event venue" /></MapView></View><Text style={styles.formLabel}>Venue latitude</Text><TextInput value={newEventLatitude} onChangeText={(value) => { setNewEventLatitude(value); const n = Number(value); if (Number.isFinite(n) && Math.abs(n) <= 90) setNewEventMapRegion((r) => ({ ...r, latitude: n })); }} keyboardType="decimal-pad" placeholder="Latitude" placeholderTextColor={COLORS.textSecondary} style={styles.formInput} /><Text style={styles.formLabel}>Venue longitude</Text><TextInput value={newEventLongitude} onChangeText={(value) => { setNewEventLongitude(value); const n = Number(value); if (Number.isFinite(n) && Math.abs(n) <= 180) setNewEventMapRegion((r) => ({ ...r, longitude: n })); }} keyboardType="decimal-pad" placeholder="Longitude" placeholderTextColor={COLORS.textSecondary} style={styles.formInput} /><Text style={styles.formLabel}>Allowed radius (meters)</Text><TextInput value={newEventRadius} onChangeText={setNewEventRadius} keyboardType="number-pad" placeholder="150" placeholderTextColor={COLORS.textSecondary} style={styles.formInput} /><Text style={styles.muted}>The blue circle shows the accepted area. Scans outside the radius are rejected by server validation.</Text></>}
<Pressable disabled={eventCreateBusy} style={[styles.action, eventCreateBusy && { opacity: 0.6 }]} onPress={() => void createAdminEvent()}><Text style={styles.actionText}>{eventCreateBusy ? 'Creating…' : 'Create event'}</Text></Pressable>
{createdEventQr && <View style={styles.qrCreated}><Text style={styles.cardTitle}>Event QR code</Text><QRCode value={createdEventQr} size={176} /><Text style={styles.muted}>Show this QR to students for this event.</Text></View>}
</View>}
{section === 'attendance' && <View style={styles.card}>
<Text style={styles.cardTitle}>Inspect one event</Text>
<Text style={styles.muted}>Choose an event to see its own venue, radius, student scans, and invalid attempts.</Text>
<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{events.map((event) => <Pressable key={event.id} onPress={() => { setSelectedAttendanceEventId(event.id); setEventStudentSearch(''); setExpandedEventStudentId(null); }} style={[styles.navItem, selectedAttendanceEventId === event.id && styles.navActive]}><Text style={styles.navText}>{event.title}</Text></Pressable>)}</View>
{(() => { const event = events.find((e) => e.id === selectedAttendanceEventId); const valid = attendance.filter((r) => r.event_id === selectedAttendanceEventId); const validStudentIds = new Set(valid.map((r) => r.student_id)); const invalid = scanAttempts.filter((r) => r.event_id === selectedAttendanceEventId && !validStudentIds.has(r.student_id)); const points: AttendanceLocationPoint[] = [...valid.filter((r) => r.latitude != null && r.longitude != null).map((r) => ({ id: r.id, eventId: r.event_id, latitude: r.latitude, longitude: r.longitude, title: eventTitle(r.event_id), description: `Student: ${userEmail(r.student_id)}`, scannedAt: r.scanned_at, status: r.attendance_status === 'late' ? 'Valid · Late' : 'Valid attendance' })), ...invalid.filter((r) => r.latitude != null && r.longitude != null).map((r) => ({ id: r.id, eventId: r.event_id, latitude: r.latitude, longitude: r.longitude, title: eventTitle(r.event_id), description: `Student: ${userEmail(r.student_id)}`, scannedAt: r.scanned_at, status: `Invalid · ${r.reason}${r.distance_meters != null ? ` · ${Math.round(r.distance_meters)} m away (limit ${r.allowed_radius_meters} m)` : ''}` }))]; return event ? <><Text style={styles.muted}>{valid.length} valid attendance · {invalid.length} invalid attempt(s){event.require_location ? ` · radius ${event.allowed_radius_meters ?? 150} m` : ' · no radius restriction'}</Text><AttendanceLocationMap points={points} venue={event.allowed_latitude != null && event.allowed_longitude != null ? { latitude: event.allowed_latitude, longitude: event.allowed_longitude } : null} radiusMeters={event.allowed_radius_meters} />
<Text style={styles.cardTitle}>Student scan attempts</Text>
<TextInput value={eventStudentSearch} onChangeText={setEventStudentSearch} placeholder="Search student name, email, or status…" placeholderTextColor={COLORS.textSecondary} style={styles.search} autoCapitalize="none" />
{[...valid.map((record) => ({ record, isValid: true })), ...invalid.map((record) => ({ record, isValid: false }))].filter(({ record, isValid }: any) => { const profile = profiles.find((p) => p.id === record.student_id); const query = `${profile?.full_name ?? ''} ${profile?.email ?? ''} ${isValid ? 'accepted valid attendance' : `invalid ${record.reason}`}`.toLowerCase(); return query.includes(eventStudentSearch.toLowerCase().trim()); }).sort((a: any, b: any) => new Date(b.record.scanned_at).getTime() - new Date(a.record.scanned_at).getTime()).map(({ record, isValid }: any) => {
 const profile = profiles.find((p) => p.id === record.student_id); const rowKey = `${record.id}-${record.student_id}`; const expanded = expandedEventStudentId === rowKey;
 return <View key={`${isValid ? 'valid' : 'invalid'}-${record.id}`} style={styles.eventStudentRow}>
 <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{profile?.full_name || profile?.email || record.student_id}</Text><Text style={styles.muted}>{profile?.email || 'Email unavailable'} · {isValid ? 'ACCEPTED · Attendance recorded' : `INVALID · ${record.reason}`}</Text><Text style={styles.muted}>{new Date(record.scanned_at).toLocaleString()}</Text></View>
 <Pressable style={styles.action} onPress={() => setExpandedEventStudentId(expanded ? null : rowKey)}><Text style={styles.actionText}>{expanded ? 'Hide profile' : 'Student profile'}</Text></Pressable>
 {expanded && <View style={styles.profileDetail}><Text style={styles.muted}>Name: {profile?.full_name || 'Not provided'}</Text><Text style={styles.muted}>Email: {profile?.email || 'Not provided'}</Text><Text style={styles.muted}>Section: {profile?.section || 'Not specified'}</Text><Text style={styles.muted}>Program: {profile?.program || 'Not specified'}</Text><Text style={styles.muted}>Role: {profile?.role || 'student'}</Text><Text style={styles.muted}>Location: {record.latitude != null && record.longitude != null ? `${record.latitude}, ${record.longitude}` : 'Unavailable'}</Text>{!isValid && record.distance_meters != null && <Text style={styles.muted}>Distance: {Math.round(record.distance_meters)} m · limit {record.allowed_radius_meters ?? event.allowed_radius_meters ?? 150} m</Text>}</View>}
 </View>;
})}
</> : <Text style={styles.muted}>No events to display.</Text>; })()}
</View>}
<FlatList
key={section}
data={
section === 'users' ? visibleProfiles
: section === 'events' ? visibleEvents
: section === 'attendance' ? visibleAttendance
: section === 'logs' ? logs
: []
}
keyExtractor={(item: any) => String(item.id)}
refreshing={refreshing}
onRefresh={loadDashboard}
scrollEnabled={false}
nestedScrollEnabled
contentContainerStyle={styles.list}
ListHeaderComponent={
section === 'overview' ? (
<View>
<Text style={styles.sectionTitle}>System overview</Text>
<View style={styles.statsGrid}>
<Stat label="Users" value={profiles.length} icon="people-outline" />
<Stat label="Events" value={events.length} icon="calendar-outline" />
<Stat label="Attendance" value={attendance.length} icon="checkmark-done-outline" />
  <Stat label="Invalid scans" value={scanAttempts.length} icon="alert-circle-outline" />
<Stat label="Audit logs" value={logs.length} icon="document-text-outline" />
</View>
<Text style={styles.sectionTitle}>Attendance analytics</Text>
<View style={styles.statsGrid}>
  <Stat label="Attendance rate" value={`${attendanceRate}%`} icon="pie-chart-outline" />
  <Stat label="Late records" value={lateCount} icon="time-outline" />
  <Stat label="On-time records" value={attendance.length - lateCount} icon="checkmark-circle-outline" />
</View>
<Text style={styles.sectionTitle}>Most attended events</Text>
{topEvents.map((event) => (
  <View key={event.id} style={styles.card}>
    <Text style={styles.cardTitle}>{event.title}</Text>
    <Text style={styles.metric}>{event.count} attendee(s)</Text>
  </View>
))}
<Text style={styles.sectionTitle}>Attendance by section</Text>
{attendanceByProfileField('section').map(([name, count]) => (
  <View key={name} style={styles.breakdownRow}>
    <Text style={styles.breakdownName}>{name}</Text>
    <Text style={styles.breakdownValue}>{count}</Text>
  </View>
))}
<Text style={styles.sectionTitle}>Attendance by program</Text>
{attendanceByProfileField('program').map(([name, count]) => (
  <View key={name} style={styles.breakdownRow}>
    <Text style={styles.breakdownName}>{name}</Text>
    <Text style={styles.breakdownValue}>{count}</Text>
  </View>
))}
<Text style={styles.muted}>Attendance rate uses recorded attendance divided by student-event opportunities. Late status currently uses a 10-minute grace period.</Text>
<Text style={styles.sectionTitle}>Student QR scan locations</Text>
<AttendanceLocationMap points={attendance.filter((r) => r.latitude != null && r.longitude != null).map((r) => ({ id: r.id, latitude: r.latitude, longitude: r.longitude, title: eventTitle(r.event_id), description: `Student: ${userEmail(r.student_id)}`, scannedAt: r.scanned_at }))} />
<Text style={styles.sectionTitle}>Attendance by event</Text>
{events.map((event) => {
const count = attendance.filter(
(record) => record.event_id === event.id
).length;
return (
<View key={event.id} style={styles.card}>
<Text style={styles.cardTitle}>{event.title}</Text>
<Text style={styles.muted}>{event.event_code}</Text>
<Text style={styles.metric}>{count} attendance record(s)</Text>
</View>
);
})}
{events.length === 0 && (
<Text style={styles.muted}>No events have been created yet.</Text>
)}
</View>
) : (
<Text style={styles.sectionTitle}>
{section === 'users' ? 'Manage users'
: section === 'events' ? 'Manage events'
: section === 'attendance' ? 'Attendance records'
: 'Recent system logs'}
</Text>
)
}
ListEmptyComponent={
section === 'overview' ? null : (
<Text style={styles.muted}>No records found.</Text>
)
}
renderItem={({ item }: any) => {
if (section === 'users') {
const profile = item as ProfileRow;
return (
<View style={styles.card}>
<Text style={styles.cardTitle}>
{profile.full_name || 'Unnamed user'}
</Text>
<Text style={styles.muted}>{profile.email}</Text>
<View style={styles.row}>
<Text style={styles.role}>{profile.role.toUpperCase()}</Text>
<Pressable style={styles.action} onPress={() => changeRole(profile)}>
<Text style={styles.actionText}>Change role</Text>
</Pressable>
</View>
<Pressable
  style={[styles.action, styles.secondaryAction]}
  onPress={() => setExpandedUserId(expandedUserId === profile.id ? null : profile.id)}
>
  <Text style={styles.actionText}>{expandedUserId === profile.id ? 'Hide details' : 'View details & attendance'}</Text>
</Pressable>
{expandedUserId === profile.id && (
  <View style={styles.detailsBox}>
    <Text style={styles.muted}>User ID: {profile.id}</Text>
    <Text style={styles.muted}>Full name: {profile.full_name || 'Not provided'}</Text>
    <Text style={styles.metric}>
      Attendance records: {attendance.filter((record) => record.student_id === profile.id).length}
    </Text>
    {attendance.filter((record) => record.student_id === profile.id).length === 0 ? (
      <Text style={styles.muted}>No attendance records for this user.</Text>
    ) : attendance
      .filter((record) => record.student_id === profile.id)
      .slice(0, 10)
      .map((record) => (
        <View key={record.id} style={styles.detailRecord}>
          <Text style={styles.cardTitle}>{eventTitle(record.event_id)}</Text>
          <Text style={styles.muted}>Scanned: {new Date(record.scanned_at).toLocaleString()}</Text>
{record.latitude != null && record.longitude != null ? <Text style={styles.muted}>GPS: {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}</Text> : <Text style={styles.muted}>No GPS location recorded</Text>}
          <Pressable
            style={styles.action}
            onPress={() => {
              setSection('attendance');
              setFilter(record.id);
              setEditingAttendanceId(record.id);
              setCorrectedTime(record.scanned_at);
            }}
          >
            <Text style={styles.actionText}>Correct this record</Text>
          </Pressable>
        </View>
      ))}
  </View>
)}
</View>
);
}
if (section === 'events') {
const event = item as EventRow;
return (
<View style={styles.card}>
<Text style={styles.cardTitle}>{event.title}</Text>
<Text style={styles.muted}>Code: {event.event_code}</Text>
<Text style={styles.muted}>
Starts: {event.start_time ? new Date(event.start_time).toLocaleString() : 'Not set'}
</Text>
<Text style={styles.muted}>
Ends: {event.end_time ? new Date(event.end_time).toLocaleString() : 'Not set'}
</Text>
<Pressable
style={[styles.action, styles.deleteAction]}
onPress={() => deleteEvent(event)}
>
<Text style={styles.deleteText}>Delete event</Text>
</Pressable>
</View>
);
}
if (section === 'attendance') {
const record = item as AttendanceRow;
const editingThis = editingAttendanceId === record.id;
return (
<View style={styles.card}>
<Text style={styles.cardTitle}>{eventTitle(record.event_id)}</Text>
<Text style={styles.muted}>Student: {userEmail(record.student_id)}</Text>
<Text style={styles.muted}>Scanned: {new Date(record.scanned_at).toLocaleString()}</Text>
{record.latitude != null && record.longitude != null ? <Text style={styles.muted}>GPS: {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}</Text> : <Text style={styles.muted}>No GPS location recorded</Text>}
{editingThis ? (
<>
<TextInput
value={correctedTime}
onChangeText={setCorrectedTime}
placeholder="2026-10-12T08:30:00+08:00"
placeholderTextColor={COLORS.textSecondary}
style={styles.search}
autoCapitalize="none"
/>
<Pressable
style={styles.action}
onPress={() => saveAttendanceTime(record)}
>
<Text style={styles.actionText}>Save correction</Text>
</Pressable>
<Pressable onPress={() => { setEditingAttendanceId(null); setCorrectedTime(''); }}>
<Text style={styles.muted}>Cancel</Text>
</Pressable>
</>
) : (
<Pressable
style={styles.action}
onPress={() => {
setEditingAttendanceId(record.id);
setCorrectedTime(record.scanned_at);
}}
>
<Text style={styles.actionText}>Correct scan time</Text>
</Pressable>
)}
</View>
);
}
const log = item as LogRow;
return (
<View style={styles.card}>
<Text style={styles.cardTitle}>{log.action}</Text>
<Text style={styles.muted}>
{log.target_type} · {log.target_id ?? 'No target'}
</Text>
<Text style={styles.muted}>
{new Date(log.created_at).toLocaleString()}
</Text>
<Text style={styles.muted}>
{JSON.stringify(log.details)}
</Text>
</View>
);
}}
/>
</ScrollView>
</View>
);
}
function Stat({
label,
value,
icon,
}: {
label: string;
value: number | string;
icon: keyof typeof Ionicons.glyphMap;
}) {
return (
<View style={styles.stat}>
<Ionicons name={icon} size={22} color={COLORS.primary} />
<Text style={styles.statValue}>{value}</Text>
<Text style={styles.muted}>{label}</Text>
</View>
);
}
const styles = StyleSheet.create({
container: { flex: 1, minHeight: 0, backgroundColor: COLORS.background },
center: {
flex: 1,
backgroundColor: COLORS.background,
alignItems: 'center',
justifyContent: 'center',
padding: 24,
},
top: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
heading: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary },
muted: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
adminContentScroll: { flex: 1, minHeight: 0 },
adminContentContainer: { flexGrow: 1, paddingBottom: 24 },
navScroll: {
width: '100%',
height: 58,
maxHeight: 58,
flexGrow: 0,
flexShrink: 0,
marginBottom: 8,
backgroundColor: COLORS.background,
zIndex: 5,
},
nav: {
flexDirection: 'row',
alignItems: 'center',
paddingHorizontal: 16,
paddingVertical: 4,
gap: 8,
},
navItem: {
flexDirection: 'row',
alignItems: 'center',
justifyContent: 'center',
flexShrink: 0,
gap: 6,
minHeight: 42,
paddingHorizontal: 14,
paddingVertical: 10,
borderRadius: 12,
backgroundColor: COLORS.card,
borderWidth: 1,
borderColor: COLORS.border,
},
navActive: {
backgroundColor: COLORS.primary,
borderColor: COLORS.primary,
},
navText: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary },
adminVenueMapWrap: { height: 190, overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginTop: 4 },
adminVenueMap: { height: 190, width: '100%' },
qrCreated: { alignItems: 'center', gap: 10, marginTop: 18, padding: 16, borderRadius: 12, backgroundColor: COLORS.background },
formLabel: { color: COLORS.textPrimary, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 5 },
formInput: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.textPrimary },
toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
eventStudentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
profileDetail: { width: '100%', marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: COLORS.background },
search: {
marginHorizontal: 16,
marginBottom: 12,
backgroundColor: COLORS.card,
borderWidth: 1,
borderColor: COLORS.border,
borderRadius: 12,
paddingHorizontal: 14,
paddingVertical: 11,
color: COLORS.textPrimary,
},
list: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 110 },
sectionTitle: {
fontSize: 18,
fontWeight: '800',
color: COLORS.textPrimary,
marginTop: 8,
marginBottom: 12,
},
statsGrid: {
flexDirection: 'row',
flexWrap: 'wrap',
gap: 12,
marginBottom: 22,
},
stat: {
flexBasis: '45%',
flexGrow: 1,
minWidth: 130,
backgroundColor: COLORS.card,
borderRadius: 16,
padding: 16,
borderWidth: 1,
borderColor: COLORS.border,
},
statValue: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary, marginTop: 8 },
card: {
backgroundColor: COLORS.card,
borderRadius: 14,
padding: 16,
marginBottom: 12,
borderWidth: 1,
borderColor: COLORS.border,
},
cardTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
metric: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, marginTop: 8 },
row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
role: { fontSize: 12, fontWeight: '800', color: COLORS.textSecondary },
action: {
alignSelf: 'flex-start',
marginTop: 12,
backgroundColor: COLORS.primary,
paddingHorizontal: 14,
paddingVertical: 10,
borderRadius: 10,
},
actionText: { color: COLORS.textPrimary, fontWeight: '800', fontSize: 12 },
secondaryAction: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
detailsBox: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
detailRecord: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
deleteAction: { backgroundColor: '#FCE8E6' },
deleteText: { color: COLORS.danger, fontWeight: '800', fontSize: 12 },
breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14, backgroundColor: COLORS.card, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
breakdownName: { flex: 1, color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' },
breakdownValue: { color: COLORS.primary, fontSize: 14, fontWeight: '800' },
errorBox: { marginHorizontal: 16, padding: 12, borderRadius: 10, backgroundColor: '#FCE8E6' },
errorText: { color: COLORS.danger, fontSize: 12 },
});
