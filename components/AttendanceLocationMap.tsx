import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import Ionicons from '@expo/vector-icons/Ionicons';
import { COLORS } from '@/constants/colors';

export type AttendanceLocationPoint = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  title: string;
  description: string;
  scannedAt: string;
  status?: string;
  eventId?: string;
};

export default function AttendanceLocationMap({ points, venue, radiusMeters }: { points: AttendanceLocationPoint[]; venue?: { latitude: number; longitude: number } | null; radiusMeters?: number | null }) {
  const mapRef = useRef<MapView | null>(null);
  const [selected, setSelected] = useState<AttendanceLocationPoint | null>(null);
  const located = useMemo(
    () => points.filter((p) => typeof p.latitude === 'number' && Number.isFinite(p.latitude) && typeof p.longitude === 'number' && Number.isFinite(p.longitude)),
    [points]
  );
  const region = useMemo<Region>(() => {
    const p = located[0];
    return { latitude: venue?.latitude ?? p?.latitude ?? 12.8797, longitude: venue?.longitude ?? p?.longitude ?? 121.774, latitudeDelta: venue || p ? 0.02 : 7, longitudeDelta: venue || p ? 0.02 : 7 };
  }, [located, venue]);

  const fitAll = () => {
    if (!mapRef.current) return;
    if (!located.length && venue) { mapRef.current.animateToRegion({ latitude: venue.latitude, longitude: venue.longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 350); return; }
    if (!located.length) return;
    if (located.length === 1 && !venue) {
      mapRef.current.animateToRegion({ latitude: located[0].latitude!, longitude: located[0].longitude!, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 350);
      return;
    }
    const coords = [...located.map((p) => ({ latitude: p.latitude!, longitude: p.longitude! })), ...(venue ? [venue] : [])];
    if (coords.length === 1) { mapRef.current.animateToRegion({ ...coords[0], latitudeDelta: 0.008, longitudeDelta: 0.008 }, 350); return; }
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 56, right: 42, bottom: 56, left: 42 }, animated: true,
    });
  };

  useEffect(() => {
    setSelected((old) => old ? located.find((p) => p.id === old.id) ?? null : null);
    if (located.length) {
      const timer = setTimeout(fitAll, 250);
      return () => clearTimeout(timer);
    }
    return;
  }, [located]);

  if (!located.length && !venue) return <View style={styles.empty}><Ionicons name="location-outline" size={26} color={COLORS.primary} /><Text style={styles.emptyTitle}>No scan locations yet</Text><Text style={styles.emptyText}>Student pins appear here after an attendance submission records GPS coordinates. Location is captured only at submission time.</Text></View>;

  return <View style={styles.wrap}>
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.caption}>{located.length} scan location{located.length === 1 ? '' : 's'}{venue ? ' · event venue shown' : ''}</Text>
        <Text style={styles.hint}>Tap a pin to view scan details. Use “Fit all” to see every recorded location.</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={fitAll} style={styles.fitButton}>
        <Ionicons name="scan-outline" size={16} color="#FFFFFF" /><Text style={styles.fitText}>Fit all</Text>
      </Pressable>
    </View>
    <MapView ref={mapRef} style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={region} onMapReady={fitAll}>
      {venue && <><Circle center={venue} radius={Math.max(1, radiusMeters ?? 150)} strokeColor="#2878D0" fillColor="rgba(40,120,208,0.14)" strokeWidth={2} /><Marker coordinate={venue} title="Designated event venue" description={`Allowed radius: ${radiusMeters ?? 150} m`} pinColor="#2878D0" /></>}
      {located.map((point) => <Marker key={point.id} coordinate={{ latitude: point.latitude!, longitude: point.longitude! }} title={point.title} description={`${point.description}\nScanned: ${new Date(point.scannedAt).toLocaleString()}`} onPress={() => setSelected(point)} />)}
    </MapView>
    {selected && <View style={styles.details}>
      <View style={styles.detailIcon}><Ionicons name="location" size={18} color={COLORS.primary} /></View>
      <View style={styles.detailCopy}>
        <Text style={styles.detailTitle}>{selected.title}</Text>
        <Text style={styles.detailText}>{selected.description}</Text>
        <Text style={styles.detailText}>{new Date(selected.scannedAt).toLocaleString()}</Text>
        {selected.status ? <Text style={[styles.detailText, { color: selected.status.toLowerCase().includes('invalid') ? '#C62828' : '#18804A', fontWeight: '700' }]}>{selected.status}</Text> : null}
        <Text style={styles.coords}>{selected.latitude!.toFixed(6)}, {selected.longitude!.toFixed(6)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close scan details" onPress={() => setSelected(null)} hitSlop={8}><Ionicons name="close-circle" size={22} color={COLORS.textSecondary} /></Pressable>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 10, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, zIndex: 0, elevation: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, backgroundColor: COLORS.card },
  headerCopy: { flex: 1 },
  caption: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '700' },
  hint: { color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  fitButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: COLORS.primary, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 9 },
  fitText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  map: { height: 180, width: '100%', zIndex: 0, elevation: 0 },
  details: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  detailIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  detailCopy: { flex: 1, gap: 3 },
  detailTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  detailText: { color: COLORS.textSecondary, fontSize: 12 },
  coords: { color: COLORS.textPrimary, fontSize: 11, fontVariant: ['tabular-nums'], marginTop: 2 },
  empty: { marginVertical: 12, padding: 18, borderRadius: 12, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, alignItems: 'flex-start' },
  emptyTitle: { color: COLORS.textPrimary, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  emptyText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
});
