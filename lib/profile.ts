export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: 'Student' | 'Teacher' | 'admin';
  studentId?: string;
  department?: string;
  avatarUrl?: string;
}

export const mockProfile: UserProfile = {
  id: 'usr_101',
  name: 'Calvin John C. Panla-an',
  email: 'calvin@school.edu.ph',
  role: 'Student',
  studentId: '2026-0042',
  department: 'College of Computer Studies',
};

export async function getUserProfile(): Promise<UserProfile> {
  return Promise.resolve(mockProfile);
}

export async function updateUserProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
  Object.assign(mockProfile, updates);
  return Promise.resolve(mockProfile);
}