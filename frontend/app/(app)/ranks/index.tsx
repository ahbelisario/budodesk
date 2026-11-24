import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { RanksHome } from '@/screens/ranks/RanksHome';

export default function Screen() {
  const { hasRole } = useSession();
  if (!hasRole('admin', 'instructor', 'staff')) return <Redirect href="/progress" />;
  return <RanksHome />;
}
