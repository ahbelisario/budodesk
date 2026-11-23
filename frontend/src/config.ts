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
