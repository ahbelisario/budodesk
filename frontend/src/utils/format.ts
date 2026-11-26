import { getLanguage } from '../i18n';

const locale = () => (getLanguage() === 'en' ? 'en-US' : 'es-MX');

export function money(amount: number | null | undefined, currency = 'MXN', { decimals = 'auto' }: { decimals?: 'auto' | 0 | 2 } = {}) {
  const n = Number(amount ?? 0);
  const d = decimals === 'auto' ? (Number.isInteger(n) ? 0 : 2) : decimals;
  return new Intl.NumberFormat(locale(), { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}

/** 'YYYY-MM-DD' → Date local (sin corrimiento de zona) */
export function parseDay(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayLong(s: string) {
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDay(s));
}
export function dayShort(s: string) {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(parseDay(s));
}
/** "14 nov 2021": para fechas que pueden ser de otros años (grados, historial) */
export function dayYear(s: string) {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(parseDay(s.slice(0, 10)));
}
export function weekdayShort(s: string) {
  return new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(parseDay(s)).replace('.', '');
}
export function monthYear(s: string) {
  return new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(parseDay(s));
}
/** 'HH:MM:SS' → 'HH:MM' */
export const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

export function fullName(p: { first_name: string; last_name?: string | null; preferred_name?: string | null }) {
  return [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' ');
}

/** Saludo según la hora */
export function greeting(now = new Date()) {
  const h = now.getHours();
  const es = getLanguage() !== 'en';
  if (h < 12) return es ? 'Buenos días' : 'Good morning';
  if (h < 19) return es ? 'Buenas tardes' : 'Good afternoon';
  return es ? 'Buenas noches' : 'Good evening';
}

/** Primera letra en mayúscula (solo la primera, no cada palabra) */
export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Marca de tiempo ISO (UTC) → "16 nov" en la hora local del dispositivo */
export function dayShortTs(iso: string) {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(iso));
}
/** Marca de tiempo ISO → "16 nov, 18:40" */
export function dateTimeShort(iso: string) {
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
