import React from 'react';
import { Redirect, Slot } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { AppShell } from '@/navigation/AppShell';
import { Loading } from '@/ui/primitives';

/** Todo lo que está aquí requiere sesión y un dojo activo */
export default function AppLayout() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (status === 'chooseDojo') return <Redirect href="/choose-dojo" />;
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
