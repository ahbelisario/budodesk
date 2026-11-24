import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { MembershipNew } from '@/screens/billing/MembershipNew';

export default function Screen() {
  const { hasRole } = useSession();
  if (!hasRole('admin', 'staff')) return <Redirect href="/payments" />;
  return <MembershipNew />;
}
