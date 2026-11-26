/**
 * Aviso de la prueba gratis del dojo:
 *  - en prueba, a dueños y administradores, la última semana
 *  - prueba vencida (solo lectura), a todos
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../session/SessionProvider';
import { signupApi } from '../api/signup';
import { Icon, Text } from '../ui/primitives';
import { palette, space } from '../theme/tokens';
import { t, useLanguage } from '../i18n';
import { dayLong } from '../utils/format';

/** Días que faltan (0 = hoy es el último día) en la zona del dojo */
export function trialDaysLeft(ends: string, timezone = 'America/Mexico_City', now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return Math.round((Date.parse(ends.slice(0, 10)) - Date.parse(today)) / 864e5);
}

let contactCache: string | null | undefined;

export function TrialBanner({ topInset }: { topInset?: boolean }) {
  useLanguage();
  const { dojo } = useSession();
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState<string | null | undefined>(contactCache);
  const isAdmin = !!dojo?.roles?.some((r) => r === 'owner' || r === 'admin');
  const expired = dojo?.status === 'expired' && !dojo.support;
  const left = dojo?.status === 'trial' && dojo.trial_ends_at ? trialDaysLeft(dojo.trial_ends_at, dojo.timezone) : null;
  const ending = isAdmin && !dojo?.support && left !== null && left >= 0 && left <= 6;
  const show = expired || ending;

  useEffect(() => {
    if (!show || !isAdmin || contactCache !== undefined) return;
    signupApi.config().then((c) => { contactCache = c.contact; setContact(c.contact); }).catch(() => {});
  }, [show, isAdmin]);

  if (!show || !dojo) return null;
  let text: string;
  if (expired) text = isAdmin ? t('signup.readOnlyOwner') : t('signup.readOnlyMember');
  else text = left === 0 ? t('signup.trialLastDay') : t('signup.trialDaysLeft', { count: left! + 1, date: dayLong(dojo.trial_ends_at!.slice(0, 10)) });
  if (isAdmin) text += ` ${contact ? t('signup.trialContact', { email: contact }) : t('signup.trialContactNoEmail')}`;

  return (
    <View accessibilityRole="alert" style={{
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      backgroundColor: expired ? palette.dangerBg : palette.warningBg,
      paddingHorizontal: space.lg, paddingVertical: space.sm, paddingTop: space.sm + (topInset ? insets.top : 0),
    }}>
      <Icon name={expired ? 'lock' : 'clock'} size={16} color={expired ? palette.danger : palette.warning} />
      <Text variant="small" color={expired ? palette.danger : palette.warning} style={{ flex: 1 }}>{text}</Text>
    </View>
  );
}
