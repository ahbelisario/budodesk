/**
 * Sesión: usuario, dojo activo, roles y "en nombre de quién" (tutor → menor).
 *
 * status:
 *   loading    → restaurando sesión al abrir la app
 *   signedOut  → sin sesión
 *   chooseDojo → con sesión pero sin dojo activo (pertenece a varios o a ninguno activo)
 *   ready      → listo para usar la app
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, applyAuth, refreshSession, setAuthListener } from '../api/client';
import { tokenStore } from '../api/tokenStore';
import type { AuthPayload, DojoSummary, Minor, Role, User } from '../api/types';
import { setLanguage } from '../i18n';
import { forgetPushOnLogout, syncPushOnLogin } from '../push/webPush';

type Status = 'loading' | 'signedOut' | 'chooseDojo' | 'ready';

type Session = {
  status: Status;
  user: User | null;
  dojo: DojoSummary | null;
  dojos: DojoSummary[];
  roles: Role[];
  /** Persona sobre la que se trabaja en pantallas de alumno (yo o un menor a cargo) */
  actingUserId: number | null;
  minors: Minor[];
  hasRole: (...r: Role[]) => boolean;
  isStaff: boolean;
  login: (identifier: string, password: string, dojoSlug?: string | null) => Promise<AuthPayload>;
  logout: () => Promise<void>;
  switchDojo: (dojoId: number) => Promise<void>;
  setActingUser: (userId: number) => void;
  reload: () => Promise<void>;
  /** "Ver como" (soporte, solo lectura) */
  impersonation: AuthPayload['impersonation'] | null;
  startImpersonation: (userId: number) => Promise<void>;
  endImpersonation: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [dojo, setDojo] = useState<DojoSummary | null>(null);
  const [dojos, setDojos] = useState<DojoSummary[]>([]);
  const [minors, setMinors] = useState<Minor[]>([]);
  const [actingUserId, setActingUserId] = useState<number | null>(null);
  const [impersonation, setImpersonation] = useState<AuthPayload['impersonation'] | null>(null);

  const apply = useCallback((p: AuthPayload | null) => {
    // Cualquier payload sin "impersonation" (refresh, cambio de dojo, login) termina la vista
    setImpersonation(p?.impersonation ?? null);
    if (!p) {
      setUser(null); setDojo(null); setDojos([]); setMinors([]); setActingUserId(null);
      setStatus('signedOut');
      return;
    }
    if (p.user) {
      setUser(p.user);
      if (p.user.language) setLanguage(p.user.language, false);
    }
    if (p.dojos) setDojos(p.dojos);
    setDojo(p.dojo);
    setStatus(p.dojo ? 'ready' : 'chooseDojo');
  }, []);

  useEffect(() => {
    setAuthListener(apply);
    // Restaurar sesión guardada
    refreshSession().then((p) => { if (!p) setStatus('signedOut'); });
  }, [apply]);

  // Al entrar a un dojo: menores a cargo (para el selector "Ver como")
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    setActingUserId((cur) => cur ?? user.id);
    if (dojo?.roles.includes('guardian')) {
      api.get<Minor[]>('/me/minors').then(setMinors).catch(() => setMinors([]));
    } else {
      setMinors([]);
    }
  }, [status, user, dojo]);

  const login = useCallback(async (identifier: string, password: string, dojoSlug?: string | null) => {
    const data = await api.public.post<AuthPayload>('/auth/login', { identifier, password, dojo_slug: dojoSlug || undefined });
    await applyAuth(data);
    syncPushOnLogin(); // si este navegador ya tenía avisos activos, ahora le llegan a quien entró
    return data;
  }, []);

  // "Ver como": el token de la otra persona vive solo en memoria (30 min, sin refresh).
  // Al salir, o al vencer, se pide un token nuevo con el refresh de quien mira.
  const startImpersonation = useCallback(async (userId: number) => {
    const data = await api.post<AuthPayload>('/impersonation', { user_id: userId });
    setActingUserId(null);
    await applyAuth(data);
  }, []);
  const endImpersonation = useCallback(async () => {
    try { await api.post('/impersonation/end'); } catch { /* el token pudo vencer */ }
    tokenStore.setAccess(null);
    setActingUserId(null);
    const back = await refreshSession();
    if (!back) apply(null);
  }, [apply]);

  const logout = useCallback(async () => {
    if (impersonation) { await endImpersonation(); return; }
    await forgetPushOnLogout(); // antes de perder la sesión
    try { await api.post('/auth/logout'); } catch { /* sin red: igual se cierra localmente */ }
    await tokenStore.clear();
    apply(null);
  }, [apply, impersonation, endImpersonation]);

  const switchDojo = useCallback(async (dojoId: number) => {
    const data = await api.post<AuthPayload>('/auth/switch-dojo', { dojo_id: dojoId });
    setActingUserId(null);
    await applyAuth({ ...data, dojos });
  }, [dojos]);

  const reload = useCallback(async () => {
    const me = await api.get<{ user: User; dojo: DojoSummary | null; dojos: DojoSummary[] }>('/auth/me');
    setUser(me.user); setDojos(me.dojos); setDojo(me.dojo);
  }, []);

  const value = useMemo<Session>(() => {
    const roles = dojo?.roles ?? [];
    // owner implica admin (igual que en el servidor)
    const hasRole = (...r: Role[]) => roles.some((x) => r.includes(x) || (x === 'owner' && r.includes('admin')));
    return {
      status, user, dojo, dojos, roles, minors,
      actingUserId: actingUserId ?? user?.id ?? null,
      hasRole,
      isStaff: hasRole('owner', 'admin', 'staff', 'instructor'),
      login, logout, switchDojo, reload,
      setActingUser: setActingUserId,
      impersonation, startImpersonation, endImpersonation,
    };
  }, [status, user, dojo, dojos, minors, actingUserId, login, logout, switchDojo, reload, impersonation, startImpersonation, endImpersonation]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession fuera de SessionProvider');
  return s;
}
