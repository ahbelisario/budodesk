import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { Reports } from '@/screens/reports/Reports';

export default function Screen() {
  const { hasRole } = useSession();
  if (!hasRole('admin', 'staff', 'instructor')) return <Redirect href="/home" />;
  return <Reports />;
}
