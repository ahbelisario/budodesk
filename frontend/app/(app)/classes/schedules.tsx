import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { SeriesManager } from '@/screens/classes/SeriesManager';

export default function Schedules() {
  const { hasRole } = useSession();
  if (!hasRole('admin', 'staff')) return <Redirect href="/classes" />;
  return <SeriesManager />;
}
