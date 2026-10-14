# SETUP COMMANDS — QR Attendance App

> **Target:** First-year students | **Expo SDK:** 54 | **Expo Go:** 54.0.8

---

## PREREQUISITES

| Tool | Download | Verify |
|---|---|---|
| Node.js (LTS) | https://nodejs.org/en | `node --version` |
| VS Code | https://code.visualstudio.com | (open it) |
| Expo Go 54.0.8 | Play Store → "Expo Go" | (version in app settings) |

---

## STEP 1 — Create the App

```powershell
cd D:\QR-ATT
npx create-expo-app@latest qr-att

# When prompted, select "SDK 54"
# Wait for npm install (~2 min)
```

---

## STEP 2 — Install Matching Versions

The default install may need these fixed versions that match Expo Go 54.0.8:

```powershell
npm install expo@~54.0.35 react@19.1.0 react-native@0.81.5 expo-router@~6.0.24 @expo/vector-icons@^15.0.3 expo-linking@~8.0.12 expo-constants@~18.0.13 expo-font@~14.0.12 expo-status-bar@~3.0.9 expo-splash-screen@~31.0.13 react-native-screens@~4.16.0 react-native-safe-area-context@~5.6.0 react-native-gesture-handler@~2.28.0 react-native-reanimated@~4.1.1 react-dom@19.1.0 react-native-web@~0.21.0 @types/react@~19.1.0 typescript@~5.9.2 --legacy-peer-deps
```

---

## STEP 3 — Start

```powershell
npx expo start
```

Scan QR code with Expo Go. Or press `W` for web.

---

## TROUBLESHOOTING

| Problem | Solution |
|---|---|
| npm install fails | Use `npm install --legacy-peer-deps` |
| App crashes in Expo Go | Make sure all versions match STEP 2 exactly |
| QR won't scan | Phone + computer on same WiFi |
| White screen | Wait 10s, or shake → Reload |
| TypeScript errors | Run `npx tsc --noEmit` |


## Smart attendance features

1. In Supabase SQL Editor, run `MD/migration-smart-attendance.sql` after the base schema. This migration adds analytics metadata, location settings, and the server-side `record_attendance` validation function.
2. Copy `.env.example` to `.env` and verify the Supabase URL and publishable anon key. Then run `npm install` after extracting the project. The app uses `expo-location` for events that require venue verification.
3. Teacher accounts can enable venue verification when creating an event. Enter venue latitude/longitude and an allowed radius (25–5000 m). The event QR includes the settings needed for offline capture; Supabase revalidates the scan when it syncs.
4. Offline scans are saved locally and retried while the app is open, including when the app returns to the foreground. They remain pending until the server accepts them.
5. Students can update their full name, section, and program in Profile so the analytics breakdowns can be meaningful.

**Hardware/provider features:** NFC/RFID needs a compatible reader and native integration or a configured keyboard-wedge reader. Face verification needs a secure verification provider/backend and an explicit consent and fallback flow. Neither is represented as active merely because a database field exists.

## Student QR scan location map

This update captures a one-time foreground GPS location when a student submits a QR attendance scan. It does not track students in the background. If location permission is declined, scans can still be submitted unless the event has venue verification enabled. Teachers see pins only for events they created; admins see scan locations in the admin attendance dashboard.

### Install map dependency

Run `npx expo install react-native-maps` in the project folder, then `npm install`. The package registry was unreachable while this ZIP was prepared, so the map dependency is declared in `package.json` but its lockfile must be regenerated on your machine.

### Apply Supabase migration

In Supabase Dashboard → SQL Editor, review and run `SUPABASE_SCAN_LOCATION_MIGRATION.sql` after the existing smart-attendance migration. This adds restricted read policies for admins and event-owning teachers. It does not make scan coordinates publicly readable. The attendance write path remains the existing `record_attendance` RPC.

The location shown is the device-reported GPS fix and may be inaccurate, especially indoors. It is not tamper-proof proof of physical presence.


## Latest update: scan maps, venue enforcement, and registration role choice

1. Install dependencies with `npm install`.
2. In Supabase Dashboard → SQL Editor, review and run `SUPABASE_SIGNUP_ROLE_MIGRATION.sql`. It updates the auth-user trigger so public signups may choose only `student` or `teacher`; it does not allow self-registration as `admin`.
3. Ensure `MD/migration-smart-attendance.sql` has already been applied. Its `record_attendance` RPC is the authoritative server-side check for the configured venue radius.
4. Run `npx expo start` and test on a physical device with location services enabled.

The scan map now fits all available pins, has a “Fit all” control, and shows selected pin details. A location-required event cannot be queued as valid while offline; the student must reconnect and submit again so the server can verify the venue radius. GPS may be inaccurate or spoofed and should not be treated as perfect proof of presence.


## Per-event scan maps and invalid attempts

For event-specific maps and visibility of rejected scans, open Supabase Dashboard → SQL Editor and run `SUPABASE_EVENT_SCAN_ATTEMPTS_MIGRATION.sql` after `MD/migration-smart-attendance.sql` and `SUPABASE_SCAN_LOCATION_MIGRATION.sql`. The migration creates a separate `attendance_scan_attempts` table for invalid location attempts; these rows never count as attendance.

Teachers can choose one of their own events to see its venue, allowed-radius circle, valid student scans, and recorded invalid attempts. Administrators can choose any event and review the same event-specific view. Student scan coordinates are captured only when attendance is submitted; this app does not track students continuously in the background.

## Admin event and per-event attendance improvements

- The Admin panel's Events section includes event creation, an in-form venue map (tap to pin), a configurable radius, and a generated QR code.
- The Admin panel's Attendance section filters scans by the selected event and shows valid attendance, rejected scan attempts, scan locations, and expandable student profile details.
- Teacher event map markers include available student identity details, and the map is more compact to preserve screen space.
- The Teacher tab is now visible only to teacher accounts; admins manage events from the Admin panel.
- The Admin panel's top section navigation is kept at a fixed height, and the app tab bar is raised above map layers to avoid map overlap.
