
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';

export default function TabLayout() {
  const { user } = useAuth();
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    let active = true;

    setRole(null);

    if (!user) {
      return () => {
        active = false;
      };
    }

    getProfile(user.id)
      .then((profile) => {
        if (active) {
          setRole(profile?.role ?? 'student');
        }
      })
      .catch((error) => {
        console.error('Failed to load user profile:', error);

        if (active) {
          setRole(null);
        }
      });

    return () => {
      active = false;
    };
  }, [user]);

  // Admins manage events from the Admin panel; keep the Teacher tab teacher-only.
  const canAccessTeacher = role === 'teacher';

  const canAccessAdmin = role === 'admin';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: COLORS.primary,
        headerStyle: {
          backgroundColor: COLORS.background,
        },
        headerShadowVisible: false,
        headerTintColor: COLORS.textPrimary,
        tabBarStyle: {
          backgroundColor: COLORS.card,
          borderTopColor: COLORS.border,
          zIndex: 100,
          elevation: 12,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'home-sharp' : 'home-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'qr-code' : 'qr-code-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          // History is hidden from administrator bottom navigation.
          href: canAccessAdmin ? null : '/(tabs)/history',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'time' : 'time-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="teacher"
        options={{
          title: 'Teacher',
          href: canAccessTeacher
            ? '/(tabs)/teacher'
            : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                focused
                  ? 'clipboard'
                  : 'clipboard-outline'
              }
              color={color}
              size={24}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: canAccessAdmin
            ? '/(tabs)/admin'
            : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={
                focused
                  ? 'shield-checkmark'
                  : 'shield-checkmark-outline'
              }
              color={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
