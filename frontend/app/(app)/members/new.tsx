import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { MemberNew } from '@/screens/members/MemberNew';

export default function NewMember() {
  const { hasRole } = useSession();
  if (!hasRole('admin', 'staff')) return <Redirect href="/members" />;
  return <MemberNew />;
}
