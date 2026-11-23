import React from 'react';
import { Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { Loading } from '@/ui/primitives';

/** Punto de entrada: manda a cada quien a su lugar según el estado de la sesión */
export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  if (status === 'signedOut') return <Redirect href="/login" />;
  if (status === 'chooseDojo') return <Redirect href="/choose-dojo" />;
  return <Redirect href="/home" />;
}
