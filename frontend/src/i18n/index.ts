import { useEffect, useReducer } from 'react';
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { es } from './es';
import { en } from './en';

export type Lang = 'es' | 'en';
const KEY = 'bd_lang';

export const i18n = new I18n({ es, en });
i18n.enableFallback = true;
i18n.defaultLocale = 'es';
i18n.locale = Localization.getLocales()?.[0]?.languageCode === 'en' ? 'en' : 'es';

const listeners = new Set<() => void>();
let savedByUser = false;

/** ¿La persona eligió idioma explícitamente? (si no, manda el idioma del dojo) */
export const hasSavedLanguage = () => savedByUser;

export function t(key: string, options?: Record<string, unknown>) {
  return i18n.t(key, options);
}

export function getLanguage(): Lang {
  return i18n.locale === 'en' ? 'en' : 'es';
}

export async function setLanguage(lang: Lang, persist = true) {
  if (persist) savedByUser = true;
  if (i18n.locale === lang && !persist) return;
  i18n.locale = lang;
  listeners.forEach((fn) => fn());
  if (!persist) return;
  if (Platform.OS === 'web') { try { window.localStorage.setItem(KEY, lang); } catch { /* */ } } else await SecureStore.setItemAsync(KEY, lang);
}

export async function loadSavedLanguage() {
  const saved = Platform.OS === 'web'
    ? (() => { try { return window.localStorage.getItem(KEY); } catch { return null; } })()
    : await SecureStore.getItemAsync(KEY);
  if (saved === 'es' || saved === 'en') { savedByUser = true; await setLanguage(saved, false); }
}

/** Re-renderiza el componente cuando cambia el idioma */
export function useLanguage() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return getLanguage();
}
