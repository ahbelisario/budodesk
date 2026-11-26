/** Plan de BudoDesk del dojo actual (límites y uso), para avisos en la app */
import { useCallback, useEffect, useState } from 'react';
import { dojoApi, type Subscription } from '../api/dojo';
import { signupApi } from '../api/signup';
import { useSession } from './SessionProvider';

let contact: Promise<string | null> | null = null;
/** Correo para contratar (SUPPORT_EMAIL del servidor), si está configurado */
export function supportContact() {
  if (!contact) contact = signupApi.config().then((c) => c.contact).catch(() => null);
  return contact;
}

export function useSubscription() {
  const { dojo } = useSession();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!dojo) return;
    dojoApi.subscription().then(setSub).catch(() => setSub(null));
  }, [dojo?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); supportContact().then(setEmail); }, [reload]);
  // Límites que aplican (null = sin límite) y el nombre del plan, para los avisos
  return { sub, reload, contactEmail: email, limits: sub?.limits ?? null, planName: sub?.plan_name ?? '' };
}
