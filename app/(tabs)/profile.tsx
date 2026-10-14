import { useState, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Alert,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { useAuth, signOut } from '@/lib/auth';
import { getProfile, updateProfile, type Profile } from '@/lib/profiles';

const PROGRAMS: Record<string, string> = {
  BSIT: 'BS Information Technology',
  BSHM: 'BS Hospitality Management',
  BSPE: 'BS Physical Education',
  BSENTREP: 'BS Entrepreneurship',
  BSED: 'Bachelor of Secondary Education',
};
const COURSES = Object.keys(PROGRAMS);
const YEARS = ['1', '2', '3', '4'];
const SECTIONS = ['A', 'B', 'C', 'D', 'E'];
const PROGRAM_OPTIONS = Object.values(PROGRAMS);

type PickerProps = {
  label: string;
  value: string;
  placeholder: string;
  options: string[];
  onSelect: (value: string) => void;
};

function Picker({ label, value, placeholder, options, onSelect }: PickerProps) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.pickerWrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={styles.pickerButton}
      >
        <Text style={[styles.pickerValue, !value && styles.placeholder]} numberOfLines={2}>
          {value || placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setVisible(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={styles.optionsList} keyboardShouldPersistTaps="handled">
              {options.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => { onSelect(option); setVisible(false); }}
                  style={[styles.option, value === option && styles.selectedOption]}
                >
                  <Text style={[styles.optionText, value === option && styles.selectedOptionText]}>{option}</Text>
                  {value === option && <Text style={styles.checkmark}>✓</Text>}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.closeButton} onPress={() => setVisible(false)}>
              <Text style={styles.closeText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export default function ProfileScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draftName, setDraftName] = useState('');
  const [course, setCourse] = useState('');
  const [year, setYear] = useState('');
  const [sectionLetter, setSectionLetter] = useState('');
  const [draftProgram, setDraftProgram] = useState('');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchingProfile, setFetchingProfile] = useState(true);
  const [saving, setSaving] = useState(false);

  const draftSection = course && year && sectionLetter
    ? `${course} ${year}${sectionLetter}`
    : '';

  const loadProfile = useCallback(async () => {
    if (!user) { setFetchingProfile(false); return; }
    setFetchingProfile(true);
    try {
      const p = await getProfile(user.id);
      setProfile(p);
      setDraftName(p?.full_name ?? '');
      setDraftProgram(p?.program ?? '');
      const match = (p?.section ?? '').trim().match(/^(BSIT|BSHM|BSPE|BSENTREP|BSED)\s*([1-4])\s*([A-E])$/i);
      if (match) {
        setCourse(match[1].toUpperCase());
        setYear(match[2]);
        setSectionLetter(match[3].toUpperCase());
      } else {
        setCourse(''); setYear(''); setSectionLetter('');
      }
    } catch {
      Alert.alert('Error', 'Unable to load your profile.');
    } finally {
      setFetchingProfile(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  // Keep the program in sync when the course changes, without overwriting a manually selected program on every render.
  useEffect(() => {
    if (course && PROGRAMS[course]) setDraftProgram(PROGRAMS[course]);
  }, [course]);

  const beginEditing = () => {
    setDraftName(profile?.full_name ?? '');
    setDraftProgram(profile?.program ?? '');
    const match = (profile?.section ?? '').trim().match(/^(BSIT|BSHM|BSPE|BSENTREP|BSED)\s*([1-4])\s*([A-E])$/i);
    if (match) {
      setCourse(match[1].toUpperCase()); setYear(match[2]); setSectionLetter(match[3].toUpperCase());
    } else {
      setCourse(''); setYear(''); setSectionLetter('');
    }
    setEditing(true);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    if (!draftName.trim()) {
      Alert.alert('Name required', 'Please enter your full name.');
      return;
    }
    if ((course || year || sectionLetter) && !draftSection) {
      Alert.alert('Section incomplete', 'Please select the course, year level, and section letter.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await updateProfile(user.id, {
        full_name: draftName.trim(),
        section: draftSection || null,
        program: draftProgram || null,
      });
      if (error) {
        Alert.alert('Unable to save profile', `${error}\n\nIf this says permission denied for table profiles, apply the Supabase SQL policy shown in the instructions.`);
        return;
      }
      setProfile((prev) => prev ? {
        ...prev,
        full_name: draftName.trim(),
        section: draftSection || null,
        program: draftProgram || null,
      } : prev);
      setEditing(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Unable to save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try { await signOut(); router.replace('/login'); }
    catch (err: any) { Alert.alert('Error', err?.message || 'Failed to sign out.'); }
    finally { setLoading(false); }
  };

  if (fetchingProfile) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={COLORS.primary} /><Text style={styles.muted}>Loading profile...</Text></View>;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>My Profile</Text>
      <View style={[styles.roleBadge, profile?.role === 'student' && styles.studentBadge]}>
        <Text style={[styles.roleText, profile?.role === 'student' && styles.studentRoleText]}>
          {profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : 'Student'}
        </Text>
      </View>

      {user && <View style={styles.infoCard}>
        <Text style={styles.label}>Email</Text><Text style={styles.value}>{user.email}</Text>
        <Text style={styles.label}>User ID</Text><Text style={styles.valueSmall}>{user.id}</Text>
      </View>}

      {editing ? <View style={styles.editCard}>
        <Text style={styles.formTitle}>Edit Profile</Text>
        <Text style={styles.label}>Full name</Text>
        <TextInput
          value={draftName}
          onChangeText={setDraftName}
          placeholder="Enter your full name"
          placeholderTextColor={COLORS.textSecondary}
          style={styles.nameInput}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="done"
        />

        <Text style={styles.label}>Section / class</Text>
        <Text style={styles.helper}>Choose your course, year level, and section separately.</Text>
        <View style={styles.sectionRow}>
          <View style={styles.courseColumn}>
            <Picker label="Course" value={course} placeholder="Course" options={COURSES} onSelect={(v) => { setCourse(v); setDraftProgram(PROGRAMS[v]); }} />
          </View>
          <View style={styles.smallColumn}>
            <Picker label="Year" value={year} placeholder="Year" options={YEARS} onSelect={setYear} />
          </View>
          <View style={styles.smallColumn}>
            <Picker label="Section" value={sectionLetter} placeholder="Letter" options={SECTIONS} onSelect={setSectionLetter} />
          </View>
        </View>
        <View style={styles.previewBox}>
          <Text style={styles.previewLabel}>Selected class</Text>
          <Text style={styles.previewValue}>{draftSection || 'Select course, year, and section'}</Text>
        </View>

        <Picker label="Academic program" value={draftProgram} placeholder="Select your program" options={PROGRAM_OPTIONS} onSelect={setDraftProgram} />

        <View style={styles.editActions}>
          <Pressable onPress={() => setEditing(false)} style={styles.cancelButton} disabled={saving}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          <Pressable onPress={handleSaveProfile} style={[styles.saveButton, saving && styles.disabled]} disabled={saving}>
            <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Profile'}</Text>
          </Pressable>
        </View>
      </View> : <View style={styles.profileCard}>
        <Text style={styles.label}>Full name</Text>
        <Text style={styles.profileName}>{profile?.full_name || 'Name not set'}</Text>
        <Text style={styles.label}>Section / class</Text>
        <Text style={styles.value}>{profile?.section || 'Not specified'}</Text>
        <Text style={styles.label}>Academic program</Text>
        <Text style={styles.value}>{profile?.program || 'Not specified'}</Text>
        <Pressable onPress={beginEditing} style={styles.editButton}><Text style={styles.editButtonText}>Edit Profile</Text></Pressable>
      </View>}

      <AppButton title="Sign Out" icon="log-out-outline" onPress={handleSignOut} disabled={loading || saving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 36 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  muted: { marginTop: 12, color: COLORS.textSecondary },
  title: { fontSize: 20, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 16 },
  infoCard: { backgroundColor: COLORS.card, borderRadius: 14, padding: 16, marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6, marginTop: 10 },
  value: { fontSize: 15, color: COLORS.textPrimary, fontWeight: '500' },
  valueSmall: { fontSize: 11, color: COLORS.textSecondary },
  roleBadge: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 16 },
  roleText: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, textTransform: 'capitalize' },
  studentBadge: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  studentRoleText: { color: '#fff' },
  editCard: { backgroundColor: COLORS.card, borderRadius: 14, padding: 16, marginBottom: 24 },
  formTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6 },
  nameInput: { width: '100%', minHeight: 48, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.textPrimary, backgroundColor: COLORS.background, fontSize: 15, marginBottom: 8 },
  helper: { color: COLORS.textSecondary, fontSize: 12, marginBottom: 4 },
  sectionRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  courseColumn: { flex: 1.35 },
  smallColumn: { flex: 1 },
  pickerWrap: { marginBottom: 8 },
  pickerButton: { minHeight: 46, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.background },
  pickerValue: { flex: 1, color: COLORS.textPrimary, fontSize: 13, paddingRight: 4 },
  placeholder: { color: COLORS.textSecondary },
  chevron: { color: COLORS.textSecondary, fontSize: 20 },
  previewBox: { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginTop: 2, marginBottom: 8 },
  previewLabel: { color: COLORS.textSecondary, fontSize: 11, marginBottom: 4 },
  previewValue: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 18 },
  cancelButton: { paddingVertical: 11, paddingHorizontal: 12 },
  cancelText: { color: COLORS.textSecondary, fontWeight: '600' },
  saveButton: { backgroundColor: COLORS.primary, paddingVertical: 11, paddingHorizontal: 16, borderRadius: 10 },
  disabled: { opacity: 0.6 },
  saveText: { color: '#fff', fontWeight: '600' },
  profileCard: { backgroundColor: COLORS.card, borderRadius: 14, padding: 16, marginBottom: 24 },
  profileName: { color: COLORS.textPrimary, fontSize: 17, fontWeight: '600' },
  editButton: { alignSelf: 'flex-start', backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, marginTop: 20 },
  editButtonText: { color: '#fff', fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 420, maxHeight: '75%', backgroundColor: COLORS.card, borderRadius: 16, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 12 },
  optionsList: { flexGrow: 0 },
  option: { minHeight: 46, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedOption: { backgroundColor: COLORS.primary },
  optionText: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  selectedOptionText: { color: '#fff', fontWeight: '600' },
  checkmark: { color: '#fff', fontWeight: '700', marginLeft: 8 },
  closeButton: { alignItems: 'center', padding: 12, marginTop: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10 },
  closeText: { color: COLORS.textPrimary, fontWeight: '600' },
});
