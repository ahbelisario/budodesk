import { ApiError } from '../api/client';
import { i18n, t } from '../i18n';

/** Mensaje para el usuario a partir de un error del API (traduce códigos conocidos). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    // Límite del plan de BudoDesk: texto propio con los números
    if (e.code === 'PLAN_LIMIT') {
      const d = e.details ?? ({} as NonNullable<ApiError['details']>);
      return `${t(`plan.limit_${d.feature ?? 'generic'}`, { limit: d.limit, current: d.current, plan: d.plan_name ?? '', defaultValue: t('plan.limit_generic') })} ${t('plan.howToUpgrade')}`;
    }
    const key = `errors.${e.code}`;
    if (i18n.translations[i18n.locale] && i18n.t(key, { defaultValue: '' })) return t(key);
    return e.message || t('errors.generic');
  }
  return t('errors.generic');
}
