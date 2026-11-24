import { ApiError } from '../api/client';
import { i18n, t } from '../i18n';

/** Mensaje para el usuario a partir de un error del API (traduce códigos conocidos). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    if (i18n.translations[i18n.locale] && i18n.t(key, { defaultValue: '' })) return t(key);
    return e.message || t('errors.generic');
  }
  return t('errors.generic');
}
