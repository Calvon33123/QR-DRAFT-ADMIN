# Smart attendance feature rollout

## Implemented in this project
- Admin analytics: attendance rate, most-attended events, section/program breakdowns, and late/on-time counts.
- QR attendance validation against event start/end times and duplicate attendance constraints.
- Configurable late grace period in the database (default 10 minutes).
- Offline attendance queue persisted with AsyncStorage and retry-safe client record IDs. The Scan screen retries while open; pending records are not shown as confirmed until Supabase accepts them.
- Optional location verification: event creators can enable venue verification and enter venue latitude, longitude, and allowed radius. The scanner requests foreground location permission and checks distance before submission; location metadata is stored with attendance.

## Requires database migration
Run `MD/migration-smart-attendance.sql` in Supabase SQL Editor after the base `MD/schema.sql`. It adds the required attendance metadata and event location settings.

## Remaining hardware/provider integration
- NFC/RFID requires a supported NFC reader and a native module or a configured Bluetooth/USB RFID reader. This Expo Go-compatible project does not pretend QR scanning is NFC.
- Face verification requires a secure identity verification provider or a carefully designed backend matching workflow, enrollment/consent, retention rules, and a non-biometric alternative. Camera capture alone is not identity verification.
- Location is a client-side distance check and should be treated as a deterrent, not tamper-proof proof of presence; stronger assurance needs server-side validation and anti-spoofing controls.

## Offline limitations
Offline scans are pending/unconfirmed until the event can be retrieved and Supabase validates the record. A scan queued offline can be delayed or rejected if the event expired, was changed, or the venue data does not match. The current retry loop runs while the Scan screen is active; it is not an OS background task.
