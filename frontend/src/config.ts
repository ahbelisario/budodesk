import { Platform } from 'react-native';

/** URL del API. Vacío = mismo origen (web detrás de nginx). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'localhost', 'qa', 'test', 'dev']);

/**
 * Dojo de la pantalla de inicio de sesión:
 *  1. subdominio en web (seikoukan.budodesk.com → "seikoukan")
 *  2. ?dojo= en la URL (enlaces de correo)
 *  3. EXPO_PUBLIC_DOJO_SLUG (desarrollo / app nativa de un dojo)
 */
export function detectDojoSlug(): string | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const fromQuery = new URLSearchParams(window.location.search).get('dojo');
    if (fromQuery) return fromQuery;
    const parts = window.location.hostname.split('.');
    if (parts.length >= 3 && !RESERVED_SUBDOMAINS.has(parts[0]) && !/^\d+$/.test(parts[0])) return parts[0];
  }
  return process.env.EXPO_PUBLIC_DOJO_SLUG || null;
}

/**
 * Dirección web de un dojo: en budodesk.com o seikoukan.budodesk.com → slug.budodesk.com.
 * En local (localhost / IP) no hay subdominios: se muestra el dominio de producción.
 */
export function dojoHost(slug: string) {
  let parent = 'budodesk.com';
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const labels = window.location.hostname.split('.');
    const local = labels.length < 2 || /^\d+$/.test(labels[labels.length - 1]);
    if (!local) parent = (labels.length >= 3 ? labels.slice(1) : labels).join('.');
  }
  return `${slug}.${parent}`;
}
