import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { PlatformScreen } from '@/screens/platform/Platform';

export default function Screen() {
  const { user } = useSession();
  if (!user?.is_superadmin) return <Redirect href="/home" />;
  return <PlatformScreen />;
}
