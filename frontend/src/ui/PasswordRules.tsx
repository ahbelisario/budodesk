/** Requisitos de contraseña en vivo: cada regla se marca en verde al cumplirse (o en rojo tras intentar guardar) */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/client';
import { Icon, Text } from './primitives';
import { palette } from '../theme/tokens';
import { t } from '../i18n';

export type PasswordPolicy = { min_length: number; require_upper: boolean; require_lower: boolean; require_number: boolean; require_symbol: boolean };
const FALLBACK: PasswordPolicy = { min_length: 10, require_upper: false, require_lower: false, require_number: false, require_symbol: false };
let cached: PasswordPolicy | null = null;

export function usePasswordPolicy(): PasswordPolicy {
  const [p, setP] = useState<PasswordPolicy>(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    api.public.get<PasswordPolicy>('/account/password-policy').then((x) => { cached = x; setP(x); }).catch(() => {});
  }, []);
  return p;
}

type Rule = { key: string; label: string; ok: boolean };
export function passwordRules(pw: string, p: PasswordPolicy): Rule[] {
  const r: Rule[] = [{ key: 'min', label: t('auth.ruleMin', { n: p.min_length }), ok: pw.length >= p.min_length }];
  if (p.require_upper) r.push({ key: 'upper', label: t('auth.ruleUpper'), ok: /\p{Lu}/u.test(pw) });
  if (p.require_lower) r.push({ key: 'lower', label: t('auth.ruleLower'), ok: /\p{Ll}/u.test(pw) });
  if (p.require_number) r.push({ key: 'number', label: t('auth.ruleNumber'), ok: /\p{Nd}/u.test(pw) });
  if (p.require_symbol) r.push({ key: 'symbol', label: t('auth.ruleSymbol'), ok: /[^\p{L}\p{Nd}\s]/u.test(pw) });
  return r;
}
export const passwordOk = (pw: string, p: PasswordPolicy) => passwordRules(pw, p).every((r) => r.ok);

/** showErrors: marca en rojo lo que falta (después de intentar guardar o en cuanto empieza a escribir) */
export function PasswordRules({ password, policy, showErrors }: { password: string; policy: PasswordPolicy; showErrors?: boolean }) {
  const rules = passwordRules(password, policy);
  const started = password.length > 0;
  return (
    <View accessibilityLabel={t('auth.rulesTitle')} style={{ gap: 4, marginTop: -4 }}>
      <Text variant="small" color={palette.ink2}>{t('auth.rulesTitle')}</Text>
      {rules.map((r) => {
        const bad = !r.ok && (showErrors || started);
        const color = r.ok ? palette.success : bad ? palette.danger : palette.ink2;
        return (
          <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            accessibilityLabel={`${r.label}: ${r.ok ? t('auth.ruleOk') : t('auth.ruleMissing')}`}>
            <Icon name={r.ok ? 'check-circle' : bad ? 'x-circle' : 'circle'} size={14} color={color} />
            <Text variant="small" color={color}>{r.label}</Text>
          </View>
        );
      })}
    </View>
  );
}
