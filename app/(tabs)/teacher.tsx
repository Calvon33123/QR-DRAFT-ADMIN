import Ionicons from '@expo/vector-icons/Ionicons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Circle, Marker, type MapPressEvent, type Region } from 'react-native-maps';
import { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { createEvent } from '@/lib/events';
import { getProfile, type Role } from '@/lib/profiles';
import { buildQRPayload } from '@/lib/qr';
import { supabase } from '@/lib/supabase';
import AttendanceLocationMap, { type AttendanceLocationPoint } from '@/components/AttendanceLocationMap';

type TeacherEventSummary = { id: string; title: string; allowed_latitude: number | null; allowed_longitude: number | null; allowed_radius_meters: number | null; require_location: boolean };

function toLocalISO(date: Date) {
  // Store a timezone-aware timestamp so Supabase and devices agree on event times.
  return date.toISOString();
}

function formatDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${month} ${pad(date.getDate())}, ${date.getFullYear()} at ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

const QUICK_END_OPTIONS = [
  { label: '+30 min', ms: 30 * 60 * 1000 },
  { label: '+1 hour', ms: 60 * 60 * 1000 },
  { label: '+2 hours', ms: 2 * 60 * 60 * 1000 },
];

type EditTarget = 'start' | 'end';

export default function TeacherScreen() {
  const { user } = useAuth();

  const [role, setRole] = useState<Role | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [eventId, setEventId] = useState('');
  const [startDate, setStartDate] = useState(() => new Date());
  const [endDate, setEndDate] = useState(
    () => new Date(Date.now() + 60 * 60 * 1000)
  );
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editingPart, setEditingPart] = useState<'date' | 'time'>('date');
  const [payload, setPayload] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requireLocation, setRequireLocation] = useState(false);
  const [venueLatitude, setVenueLatitude] = useState('');
  const [venueLongitude, setVenueLongitude] = useState('');
  const [venueRadius, setVenueRadius] = useState('150');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [venueSearch, setVenueSearch] = useState('');
  const [venueSearchLoading, setVenueSearchLoading] = useState(false);
  const [venueMapRegion, setVenueMapRegion] = useState<Region>({ latitude: 10.3157, longitude: 123.8854, latitudeDelta: 0.06, longitudeDelta: 0.06 });
  const [scanLocations, setScanLocations] = useState<AttendanceLocationPoint[]>([]);
  const [teacherEvents, setTeacherEvents] = useState<TeacherEventSummary[]>([]);
  const [selectedMapEventId, setSelectedMapEventId] = useState<string | null>(null);
  const [eventScanSearch, setEventScanSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      let active = true;

      if (!user) {
        setRoleLoading(false);
        return () => {
          active = false;
        };
      }

      supabase.from('events').select('id, title, allowed_latitude, allowed_longitude, allowed_radius_meters, require_location').eq('created_by', user.id).order('created_at', { ascending: false }).then(async ({ data: ownedEvents }) => {
        if (!active) return;
        const events = (ownedEvents ?? []) as TeacherEventSummary[];
        setTeacherEvents(events);
        setSelectedMapEventId((current) => current && events.some((e) => e.id === current) ? current : events[0]?.id ?? null);
        if (!events.length) { setScanLocations([]); return; }
        const ids = events.map((event) => event.id);
        const [attendanceResult, attemptsResult] = await Promise.all([
          supabase.from('attendance').select('id, event_id, scanned_at, latitude, longitude, student_id').in('event_id', ids).order('scanned_at', { ascending: false }).limit(500),
          supabase.from('attendance_scan_attempts').select('id, event_id, scanned_at, latitude, longitude, student_id, distance_meters, allowed_radius_meters, reason').in('event_id', ids).order('scanned_at', { ascending: false }).limit(500),
        ]);
        if (!active) return;
        const allRows: any[] = (attendanceResult.data ?? []).map((r: any) => ({ ...r, result: 'Valid attendance' }));
        const invalidRows: any[] = (attemptsResult.data ?? []).map((r: any) => ({ ...r, result: `Invalid · ${r.reason}${r.distance_meters != null ? ` · ${Math.round(r.distance_meters)} m away (limit ${r.allowed_radius_meters} m)` : ''}` }));
        const rows = [...allRows, ...invalidRows];
        const studentIds = [...new Set(rows.map((r) => r.student_id).filter(Boolean))];
        const { data: profiles } = studentIds.length ? await supabase.from('profiles').select('id, full_name, email, section, program').in('id', studentIds) : { data: [] } as any;
        if (!active) return;
        const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, `${p.full_name || 'Student'} · ${p.email || 'no email'}${p.section ? ` · Section: ${p.section}` : ''}${p.program ? ` · Program: ${p.program}` : ''}`]));
        const titles = new Map(events.map((event) => [event.id, event.title]));
        setScanLocations(rows.map((row: any) => ({ id: row.id, eventId: row.event_id, latitude: row.latitude, longitude: row.longitude, title: titles.get(row.event_id) ?? 'Attendance scan', description: `Student: ${profileMap.get(row.student_id) ?? row.student_id}`, scannedAt: row.scanned_at, status: row.result })));
      });

      getProfile(user.id).then((profile) => {
        if (!active) return;
        setRole(profile?.role ?? 'student');
        setRoleLoading(false);
      });

      return () => {
        active = false;
      };
    }, [user])
  );

  if (roleLoading) {
    return (
      <View style={styles.lockContainer}>
        <Text style={styles.lockTitle}>Checking your account...</Text>
      </View>
    );
  }

  if (role !== 'teacher') {
    return (
      <View style={styles.lockContainer}>
        <Ionicons
          name="lock-closed-outline"
          size={48}
          color={COLORS.primary}
        />
        <Text style={styles.lockTitle}>Teachers Only</Text>
        <Text style={styles.lockSubtitle}>
          Only teacher accounts can create events.
        </Text>
      </View>
    );
  }

  const isAndroid = Platform.OS === 'android';

  const openPicker = (target: EditTarget) => {
    setMessage(null);
    setEditTarget(target);
    setEditingPart('date');
  };

  const onPickerChange = (
    event: DateTimePickerEvent,
    selected?: Date
  ) => {
    if (!editTarget) return;

    if (event.type === 'dismissed' || !selected) {
      setEditTarget(null);
      setEditingPart('date');
      return;
    }

    const current = editTarget === 'start' ? startDate : endDate;
    const next = new Date(current);

    next.setFullYear(
      selected.getFullYear(),
      selected.getMonth(),
      selected.getDate()
    );

    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);

    if (editTarget === 'start') {
      setStartDate(next);
    } else {
      setEndDate(next);
    }

    if (isAndroid && editingPart === 'date') {
      setEditingPart('time');
    } else {
      setEditTarget(null);
      setEditingPart('date');
    }
  };

  const handleQuickEnd = (ms: number) => {
    setMessage(null);
    setEndDate(new Date(startDate.getTime() + ms));
  };

  const captureVenueLocation = async () => {
    setMessage(null);
    setLocationStatus(null);
    setLocationLoading(true);

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationStatus('Turn on Location Services on this device, then try again.');
        return;
      }

      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        permission = await Location.requestForegroundPermissionsAsync();
      }

      if (!permission.granted) {
        setLocationStatus('Location permission was not granted. Enable it in your device settings to capture the venue.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      setVenueLatitude(String(position.coords.latitude));
      setVenueLongitude(String(position.coords.longitude));
      setVenueMapRegion({ latitude: position.coords.latitude, longitude: position.coords.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      setLocationStatus(
        `Venue location captured (accuracy about ${Math.round(position.coords.accuracy ?? 0)} m). Review the radius before creating the event.`
      );
    } catch (error) {
      setLocationStatus(
        'Could not get your location. Check GPS permission and signal, then try again.'
      );
    } finally {
      setLocationLoading(false);
    }
  };

  const selectVenueOnMap = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setVenueLatitude(String(latitude));
    setVenueLongitude(String(longitude));
    setVenueMapRegion((region) => ({ ...region, latitude, longitude, latitudeDelta: Math.min(region.latitudeDelta, 0.03), longitudeDelta: Math.min(region.longitudeDelta, 0.03) }));
    setLocationStatus(`Pinned venue: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}. Drag the pin or tap another place to adjust it.`);
  };

  const searchVenueAddress = async () => {
    const query = venueSearch.trim();
    if (!query) {
      setLocationStatus('Enter a building, landmark, or address to search.');
      return;
    }
    setVenueSearchLoading(true);
    setLocationStatus(null);
    try {
      const results = await Location.geocodeAsync(query);
      if (!results.length) {
        setLocationStatus('No matching location found. Try a more specific address or pin the map manually.');
        return;
      }
      const match = results[0];
      setVenueLatitude(String(match.latitude));
      setVenueLongitude(String(match.longitude));
      setVenueMapRegion({ latitude: match.latitude, longitude: match.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 });
      setLocationStatus('Search result pinned. Check the map and move the pin to the exact event area.');
    } catch {
      setLocationStatus('Could not search this address right now. You can still tap the map to place the pin.');
    } finally {
      setVenueSearchLoading(false);
    }
  };

  const handleCreateEvent = () => {
    const eventData = {
      eventId: eventId.trim(),
      title: title.trim(),
      start: toLocalISO(startDate),
      end: toLocalISO(endDate),
      requireLocation,
      allowedLatitude: requireLocation ? Number(venueLatitude) : null,
      allowedLongitude: requireLocation ? Number(venueLongitude) : null,
      allowedRadiusMeters: Number(venueRadius) || 150,
    };

    if (!eventData.eventId || !eventData.title) {
      setMessage('Event title and code are required.');
      return;
    }

    if (requireLocation && (!venueLatitude.trim() || !venueLongitude.trim() || !Number.isFinite(Number(venueLatitude)) || !Number.isFinite(Number(venueLongitude)) || Math.abs(Number(venueLatitude)) > 90 || Math.abs(Number(venueLongitude)) > 180 || !Number.isFinite(Number(venueRadius)) || Number(venueRadius) < 25 || Number(venueRadius) > 5000)) {
      setMessage('Enter valid venue coordinates and a radius from 25 to 5000 meters, or turn off location verification.');
      return;
    }

    if (endDate.getTime() <= startDate.getTime()) {
      setMessage('End time must be after start time.');
      return;
    }

    createEvent(eventData).then(({ error }) => {
      if (error) {
        setMessage('Could not save the event. Please try again.');
        return;
      }

      setMessage('Event saved! Scan the QR with the Scan tab to test it.');
      setPayload(buildQRPayload({ ...eventData, location: requireLocation ? { required: true, latitude: Number(venueLatitude), longitude: Number(venueLongitude), radiusMeters: Number(venueRadius) || 150 } : { required: false } }));
    });
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Create Event QR</Text>
      <Text style={styles.title}>Event Attendance & Scan Locations</Text>
      <Text style={styles.subtitle}>Choose an event to view only its venue, allowed radius, valid scans, and recorded invalid attempts.</Text>
      {teacherEvents.length > 0 ? <View style={styles.chipRow}>{teacherEvents.map((event) => <Pressable key={event.id} onPress={() => { setSelectedMapEventId(event.id); setEventScanSearch(''); }} style={[styles.chip, selectedMapEventId === event.id && styles.selectedEventChip]}><Text style={[styles.chipText, selectedMapEventId === event.id && styles.selectedEventChipText]}>{event.title}</Text></Pressable>)}</View> : <Text style={styles.hint}>Create an event to see its attendance map here.</Text>}
      {(() => { const selectedEvent = teacherEvents.find((e) => e.id === selectedMapEventId); const eventScans = scanLocations.filter((p) => p.eventId === selectedMapEventId); const filteredScans = eventScans.filter((p) => `${p.description} ${p.status ?? ''} ${p.scannedAt}`.toLowerCase().includes(eventScanSearch.toLowerCase().trim())).sort((a, b) => new Date(b.scannedAt).getTime() - new Date(a.scannedAt).getTime()); return selectedEvent ? <><Text style={styles.subtitle}>{selectedEvent.require_location ? `Allowed radius: ${selectedEvent.allowed_radius_meters ?? 150} m. Blue circle is the accepted area.` : 'This event does not require radius verification.'}</Text><AttendanceLocationMap points={eventScans} venue={selectedEvent.allowed_latitude != null && selectedEvent.allowed_longitude != null ? { latitude: selectedEvent.allowed_latitude, longitude: selectedEvent.allowed_longitude } : null} radiusMeters={selectedEvent.allowed_radius_meters} /><Text style={styles.subtitle}>Student scan attempts ({eventScans.length})</Text><TextInput style={styles.input} value={eventScanSearch} onChangeText={setEventScanSearch} placeholder="Search student, email, or status…" placeholderTextColor={COLORS.textSecondary} autoCapitalize="none" />{filteredScans.length ? filteredScans.map((scan) => <View key={scan.id} style={styles.scanRow}><View style={{ flex: 1 }}><Text style={styles.scanStudent} numberOfLines={2}>{scan.description.replace(/^Student: /, '')}</Text><Text style={[styles.scanStatus, { color: (scan.status ?? '').toLowerCase().includes('invalid') ? COLORS.danger : '#18804A' }]}>{(scan.status ?? 'Accepted').toUpperCase()}</Text><Text style={styles.hint}>{new Date(scan.scannedAt).toLocaleString()}</Text><Text style={styles.hint}>{scan.latitude?.toFixed(5)}, {scan.longitude?.toFixed(5)}</Text></View></View>) : <Text style={styles.hint}>No scan attempts match this search. Attempts without GPS coordinates remain in the list when they match your search, but cannot be pinned on the map.</Text>}</> : null; })()}
      <Text style={styles.subtitle}>
        Fill in the event details, then scan the generated QR with the Scan tab.
      </Text>

      <Text style={styles.label}>Event Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Founders Day Assembly"
        placeholderTextColor={COLORS.textSecondary}
      />

      <Text style={styles.label}>Event Code</Text>
      <TextInput
        style={styles.input}
        value={eventId}
        onChangeText={setEventId}
        placeholder="e.g. EVT-2026-0002"
        placeholderTextColor={COLORS.textSecondary}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>Starts</Text>
      <PickerField
        value={formatDateTime(startDate)}
        icon="sunny-outline"
        onPress={() => openPicker('start')}
      />

      <Text style={styles.label}>Ends</Text>
      <PickerField
        value={formatDateTime(endDate)}
        icon="moon-outline"
        onPress={() => openPicker('end')}
      />

      <View style={styles.chipRow}>
        {QUICK_END_OPTIONS.map((option) => (
          <Pressable
            key={option.label}
            style={styles.chip}
            onPress={() => handleQuickEnd(option.ms)}
          >
            <Text style={styles.chipText}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.hint}>
        Tap a chip to set the end time from start.
      </Text>

      <Pressable style={styles.locationToggle} onPress={() => setRequireLocation((value) => !value)}>
        <Ionicons name={requireLocation ? 'checkbox' : 'square-outline'} size={22} color={COLORS.primary} />
        <View style={styles.locationToggleCopy}>
          <Text style={styles.locationToggleTitle}>Require location verification</Text>
          <Text style={styles.hint}>Attendance is accepted only near the configured venue.</Text>
        </View>
      </Pressable>
      {requireLocation && (
        <View style={styles.locationFields}>
          <Text style={styles.label}>Pin the event venue</Text>
          <Text style={styles.hint}>
            You do not need to be at the venue. Search for a building or address, or tap the map to place the pin. Drag the pin to fine-tune it.
          </Text>
          <View style={styles.venueSearchRow}>
            <TextInput
              style={[styles.input, styles.venueSearchInput]}
              value={venueSearch}
              onChangeText={setVenueSearch}
              placeholder="Search building, landmark, address"
              placeholderTextColor={COLORS.textSecondary}
              returnKeyType="search"
              onSubmitEditing={searchVenueAddress}
            />
            <Pressable accessibilityRole="button" disabled={venueSearchLoading} style={styles.venueSearchButton} onPress={searchVenueAddress}>
              <Ionicons name={venueSearchLoading ? 'hourglass-outline' : 'search'} size={20} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={styles.venueMapWrap}>
            <MapView
              style={styles.venueMap}
              initialRegion={venueMapRegion}
              region={venueMapRegion}
              onRegionChangeComplete={setVenueMapRegion}
              onPress={selectVenueOnMap}
            >
              {venueLatitude !== '' && venueLongitude !== '' && Number.isFinite(Number(venueLatitude)) && Number.isFinite(Number(venueLongitude)) && (
                <>
                  <Circle center={{ latitude: Number(venueLatitude), longitude: Number(venueLongitude) }} radius={Number(venueRadius) || 150} fillColor="rgba(30, 136, 229, 0.16)" strokeColor="rgba(30, 136, 229, 0.8)" />
                  <Marker
                    coordinate={{ latitude: Number(venueLatitude), longitude: Number(venueLongitude) }}
                    title="Event venue"
                    description="Drag this pin to adjust the event location"
                    draggable
                    onDragEnd={(event) => selectVenueOnMap({ nativeEvent: { ...event.nativeEvent, coordinate: event.nativeEvent.coordinate } } as MapPressEvent)}
                  />
                </>
              )}
            </MapView>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={locationLoading}
            style={({ pressed }) => [styles.captureLocationButton, pressed && !locationLoading && styles.captureLocationButtonPressed, locationLoading && styles.captureLocationButtonDisabled]}
            onPress={captureVenueLocation}
          >
            <Ionicons name={locationLoading ? 'hourglass-outline' : 'navigate-outline'} size={20} color={COLORS.primary} />
            <Text style={styles.captureLocationButtonText}>
              {locationLoading ? 'Getting current location…' : 'Use My Current Location Instead'}
            </Text>
          </Pressable>
          {Boolean(venueLatitude && venueLongitude) && (
            <View style={styles.locationPreview}>
              <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />
              <View style={styles.locationPreviewCopy}>
                <Text style={styles.locationPreviewTitle}>Event venue pin selected</Text>
                <Text style={styles.locationPreviewText}>{Number(venueLatitude).toFixed(6)}, {Number(venueLongitude).toFixed(6)}</Text>
              </View>
            </View>
          )}
          {locationStatus && <Text style={styles.locationStatus}>{locationStatus}</Text>}

          <Text style={styles.label}>Allowed radius (meters)</Text>
          <TextInput
            style={styles.input}
            value={venueRadius}
            onChangeText={setVenueRadius}
            keyboardType="number-pad"
            placeholder="150"
            placeholderTextColor={COLORS.textSecondary}
          />
          <Text style={styles.hint}>
            Students must be within this distance of the saved venue to pass the location check. The default is 150 meters.
          </Text>
        </View>
      )}

      {message && <Text style={styles.message}>{message}</Text>}

      <AppButton
        theme="primary"
        title="Create Event"
        icon="add-circle-outline"
        onPress={handleCreateEvent}
      />

      {editTarget && (
        <View style={styles.pickerContainer}>
          <DateTimePicker
            value={editTarget === 'start' ? startDate : endDate}
            mode={isAndroid ? editingPart : 'datetime'}
            display={isAndroid ? 'default' : 'spinner'}
            onChange={onPickerChange}
          />
        </View>
      )}

      {payload && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>
            Scan this QR code with the Scan tab:
          </Text>

          <View style={styles.qrBox}>
            <QRCode value={payload} size={200} />
          </View>

          <Text style={styles.payloadText}>{payload}</Text>
        </View>
      )}
    </ScrollView>
  );
}

type PickerFieldProps = {
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

function PickerField({ value, icon, onPress }: PickerFieldProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.pickerField,
        pressed && styles.pickerFieldPressed,
      ]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={20} color={COLORS.primary} />
      <Text style={styles.pickerValue}>{value}</Text>
      <Ionicons
        name="calendar-outline"
        size={18}
        color={COLORS.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 120,
  },
  scanRow: { flexDirection: 'row', paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  scanStudent: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700' },
  scanStatus: { fontSize: 12, fontWeight: '800', marginTop: 4 },
  lockContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  lockTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 12,
    textAlign: 'center',
  },
  lockSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginTop: 6,
    textAlign: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  pickerField: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickerFieldPressed: {
    backgroundColor: COLORS.surface,
  },
  pickerValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.textPrimary,
    marginHorizontal: 10,
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: 8,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginRight: 8,
  },
  locationToggle: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 18, padding: 12, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  locationToggleCopy: { flex: 1 },
  locationToggleTitle: { fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  locationFields: { marginTop: 4, paddingBottom: 8 },
  venueSearchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  venueSearchInput: { flex: 1 },
  venueSearchButton: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary },
  venueMapWrap: { marginTop: 12, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  venueMap: { height: 300, width: '100%' },
  captureLocationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.card,
  },
  captureLocationButtonPressed: {
    opacity: 0.75,
  },
  captureLocationButtonDisabled: {
    opacity: 0.55,
  },
  captureLocationButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  locationPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
  },
  locationPreviewCopy: {
    flex: 1,
  },
  locationPreviewTitle: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  locationPreviewText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
  locationStatus: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.primary,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 6,
  },
  pickerContainer: {
    marginTop: 12,
    alignItems: 'center',
  },
  message: {
    fontSize: 14,
    color: COLORS.primary,
    textAlign: 'center',
    marginTop: 12,
  },
  resultCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  qrBox: {
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  payloadText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  selectedEventChip: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  selectedEventChipText: { color: '#FFFFFF' },
});