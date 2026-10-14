import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getPendingAttendanceCount, registerAttendance, syncPendingAttendance } from '@/lib/attendance';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [lastData, setLastData] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    let active = true;
    let syncing = false;
    const refreshQueue = async () => {
      if (syncing || AppState.currentState !== 'active') return;
      syncing = true;
      try {
        const result = await syncPendingAttendance();
        if (active && result.rejected > 0) setSyncNotice(`${result.rejected} queued record(s) could not be validated and were removed.`);
        const count = await getPendingAttendanceCount();
        if (active) setPendingCount(count);
      } finally {
        syncing = false;
      }
    };
    void refreshQueue();
    // Retry periodically while the app is open; the queue is also retried on foreground.
    const interval = setInterval(() => { void refreshQueue(); }, 15000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshQueue();
    });
    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera Permission Needed</Text>
        <Text style={styles.subtitle}>
          We need access to your camera to scan QR codes.
        </Text>
        <AppButton
          theme="primary"
          title="Grant Permission"
          icon="camera"
          onPress={requestPermission}
        />
      </View>
    );
  }

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    setScanned(true);
    setLastData(data);
    const studentId = user?.id ?? 'unknown';
    registerAttendance(data, studentId).then(async (result) => {
      setMessage(result.message);
      setSuccess(result.success);
      setPendingCount(await getPendingAttendanceCount());
    });
  };

  const handleScanAgain = () => {
    setScanned(false);
    setLastData(null);
    setMessage(null);
  };

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      />

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          {scanned ? 'QR Code detected!' : 'Point your camera at a QR code'}
        </Text>

        {scanned && message && (
          <Text
            style={[styles.scanResult, message.includes('pending server validation') ? styles.pending : success ? styles.success : styles.error]}
          >
            {message}
          </Text>
        )}
        {pendingCount > 0 && (
          <Text style={styles.pendingCount}>{pendingCount} attendance record(s) waiting to sync</Text>
        )}
        {syncNotice && <Text style={styles.pendingCount}>{syncNotice}</Text>}

        {scanned && lastData && (
          <Text style={styles.scanData}>{lastData}</Text>
        )}

        {scanned && (
          <AppButton
            theme="primary"
            title="Scan Again"
            icon="refresh"
            onPress={handleScanAgain}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  overlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 60,
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  overlayText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    textAlign: 'center',
  },
  scanResult: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  success: {
    color: '#2E7D32',
  },
  error: {
    color: '#C62828',
  },
  pending: { color: '#B26A00' },
  pendingCount: { color: '#B26A00', fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  scanData: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
});

