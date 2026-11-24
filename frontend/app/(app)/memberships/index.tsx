import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { Memberships } from '@/screens/billing/Memberships';

export default function Screen() {
  const { hasRole } = useSession();
  if (!hasRole('admin', 'staff')) return <Redirect href="/payments" />;
  return <Memberships />;
}
