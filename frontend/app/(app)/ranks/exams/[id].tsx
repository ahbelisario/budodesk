import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { ExamDetail } from '@/screens/ranks/ExamDetail';

export default function Screen() {
  const { hasRole } = useSession();
  if (!hasRole('admin', 'instructor', 'staff')) return <Redirect href="/progress" />;
  return <ExamDetail />;
}
