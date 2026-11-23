/**
 * Tokens de sesión.
 *  - access token: solo en memoria (dura 15 min)
 *  - refresh token: SecureStore en móvil; localStorage en web
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'bd_refresh_token';

let accessToken: string | null = null;
let accessExpiresAt = 0;

export const tokenStore = {
  getAccess: () => accessToken,
  /** true si el access token vence en menos de 30 s */
  accessExpiring: () => !accessToken || Date.now() > accessExpiresAt - 30_000,
  setAccess(token: string | null, expiresAtIso?: string) {
    accessToken = token;
    accessExpiresAt = expiresAtIso ? Date.parse(expiresAtIso) : 0;
  },

  async getRefresh(): Promise<string | null> {
    if (Platform.OS === 'web') {
      try { return window.localStorage.getItem(REFRESH_KEY); } catch { return null; }
    }
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async setRefresh(token: string | null) {
    if (Platform.OS === 'web') {
      try {
        if (token) window.localStorage.setItem(REFRESH_KEY, token);
        else window.localStorage.removeItem(REFRESH_KEY);
      } catch { /* modo privado */ }
      return;
    }
    if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
  async clear() {
    accessToken = null;
    accessExpiresAt = 0;
    await this.setRefresh(null);
  },
};
