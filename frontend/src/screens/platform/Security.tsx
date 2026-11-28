/** Plataforma → Seguridad: reglas de contraseña para toda la plataforma */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '../../api/client';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Button, Card, Field, Loading, Notice, SectionHeader, Text } from '../../ui/primitives';
import { SwitchRow } from '../../ui/forms';
import { PasswordRules, type PasswordPolicy } from '../../ui/PasswordRules';
import { palette, space } from '../../theme/tokens';
import { t } from '../../i18n';

const pt = (k: string, o?: Record<string, unknown>) => t(`platform.${k}`, o);

export function SecurityTab() {
  const data = useApi(() => api.get<PasswordPolicy>('/platform/security/password-policy'), []);
  const [p, setP] = useState<PasswordPolicy | null>(null);
  const [len, setLen] = useState('');
  const [sample, setSample] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  useEffect(() => { if (data.data) { setP(data.data); setLen(String(data.data.min_length)); } }, [data.data]);
  if (!p) return data.error ? <Notice tone="danger">{errorMessage(data.error)}</Notice> : <Loading />;

  const n = Number(len);
  const lenErr = !Number.isInteger(n) || n < 8 || n > 64 ? pt('sec_lenRange') : null;
  async function save() {
    if (lenErr) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.put<PasswordPolicy>('/platform/security/password-policy', { ...p, min_length: n });
      setP(r); setMsg({ tone: 'success', text: pt('sec_saved') });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: space.md, maxWidth: 640 }}>
      <Card style={{ gap: space.md }}>
        <SectionHeader title={pt('sec_title')} />
        <Text variant="small" color={palette.ink2}>{pt('sec_intro')}</Text>
        <Field label={pt('sec_minLength')} value={len} onChangeText={setLen} keyboardType="number-pad" error={lenErr} hint={pt('sec_minHint')} style={{ maxWidth: 120 }} />
        <SwitchRow label={pt('sec_upper')} value={p.require_upper} onChange={(v) => setP({ ...p, require_upper: v })} />
        <SwitchRow label={pt('sec_lower')} value={p.require_lower} onChange={(v) => setP({ ...p, require_lower: v })} />
        <SwitchRow label={pt('sec_number')} value={p.require_number} onChange={(v) => setP({ ...p, require_number: v })} />
        <SwitchRow label={pt('sec_symbol')} value={p.require_symbol} onChange={(v) => setP({ ...p, require_symbol: v })} />
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <Button label={t('common.save')} icon="check" loading={busy} disabled={!!lenErr} onPress={save} style={{ alignSelf: 'flex-start' }} />
      </Card>
      <Card style={{ gap: space.sm }}>
        <SectionHeader title={pt('sec_preview')} />
        <Text variant="small" color={palette.ink2}>{pt('sec_previewHint')}</Text>
        <Field label={pt('sec_sample')} value={sample} onChangeText={setSample} autoComplete="off" />
        <PasswordRules password={sample} policy={{ ...p, min_length: lenErr ? p.min_length : n }} />
      </Card>
    </View>
  );
}
