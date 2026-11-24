import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { Settings } from '@/screens/dojo/Settings';

export default function Screen() {
  const { hasRole } = useSession();
  if (!hasRole('admin')) return <Redirect href="/home" />;
  return <Settings />;
}
