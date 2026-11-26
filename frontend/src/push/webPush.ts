/**
 * Notificaciones del navegador (web push) y app instalable.
 *
 * - En Android/Chrome y en computadora funcionan desde el navegador.
 * - En iPhone/iPad solo cuando BudoDesk está agregada a la pantalla de inicio (iOS 16.4+).
 * El permiso solo se pide al tocar un botón (lo exige Safari).
 */
import { Platform } from 'react-native';
import { api, request } from '../api/client';

const forget = (endpoint: string) => request('/notifications/web-push', { method: 'DELETE', body: { endpoint } });

export type PushState =
  | 'unsupported'      // este navegador no tiene push
  | 'needs-install'    // iPhone/iPad en Safari: primero agregar a la pantalla de inicio
  | 'denied'           // la persona bloqueó las notificaciones
  | 'off'              // se puede activar
  | 'on';              // activas en este dispositivo

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

export function isIOS() {
  if (!isWeb) return false;
  const ua = navigator.userAgent;
  // iPadOS se presenta como Mac con pantalla táctil
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** ¿Se abrió como app instalada (pantalla de inicio / app instalada)? */
export function isStandalone() {
  if (!isWeb) return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

const supported = () => isWeb && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

// Chrome/Edge/Android avisan cuando la página se puede instalar; se guarda para un botón «Instalar app»
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
if (isWeb) {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e as InstallPrompt; installListeners.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { installPrompt = null; installListeners.forEach((f) => f()); });
}
export const canInstall = () => !!installPrompt && !isStandalone();
export function onInstallChange(f: () => void) { installListeners.add(f); return () => { installListeners.delete(f); }; }
export async function promptInstall() {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const r = await installPrompt.userChoice;
  installPrompt = null; installListeners.forEach((f) => f());
  return r.outcome === 'accepted';
}

/** Registra el service worker (una vez, al abrir la app en web) */
export function registerServiceWorker() {
  if (!isWeb || !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null);
  }
  return registration;
}

async function currentSubscription() {
  const reg = await registerServiceWorker();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (!isWeb) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted' && (await currentSubscription())) return 'on';
  return 'off';
}

function keyBytes(b64url: string) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (isIOS() && /Macintosh/.test(ua)) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${br} en ${os}${isStandalone() ? ' (app)' : ''}`;
}

async function sendToServer(sub: PushSubscription) {
  await api.post('/notifications/web-push', { subscription: sub.toJSON(), device_name: deviceName() });
}

/** Pide permiso (debe llamarse al tocar un botón) y suscribe este navegador */
export async function enablePush(): Promise<PushState> {
  const state = await pushState();
  if (state === 'needs-install' || state === 'unsupported' || state === 'denied') return state;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const reg = await registerServiceWorker();
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const { public_key: key } = await api.get<{ public_key: string }>('/notifications/web-push/key');
  let sub = await reg.pushManager.getSubscription();
  // Si el servidor cambió de llaves, la suscripción vieja ya no sirve
  if (sub) {
    const current = sub.options?.applicationServerKey;
    const same = current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === key;
    if (!same) { await sub.unsubscribe().catch(() => {}); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await sendToServer(sub);
  return 'on';
}

/** Apaga las notificaciones en este navegador */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await forget(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/**
 * Al iniciar sesión: si este navegador ya tenía las notificaciones activas, se registra a nombre
 * de quien entró (equipo compartido, o llaves nuevas en el servidor).
 */
export async function syncPushOnLogin() {
  try {
    if ((await pushState()) !== 'on') return;
    await enablePush();
  } catch { /* sin red o sin permiso: no pasa nada */ }
}

/** Al cerrar sesión: que esta cuenta deje de recibir avisos aquí (el permiso del navegador se conserva) */
export async function forgetPushOnLogout() {
  try {
    const sub = await currentSubscription();
    if (sub) await forget(sub.endpoint);
  } catch { /* sin red: no pasa nada */ }
}

export async function sendTestPush() {
  return api.post<{ sent: number; gone: number; failed: number; lastError: string | null }>('/notifications/web-push/test', {});
}
