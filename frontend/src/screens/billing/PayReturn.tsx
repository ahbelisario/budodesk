/** Regreso de PayPal / Mercado Pago: confirma el pago con el servidor y muestra el resultado */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { onlineApi, type Checkout } from '../../api/online';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Button, Card, Icon, Loading, Notice, Text, type IconName } from '../../ui/primitives';
import { palette, space } from '../../theme/tokens';
import { t, useLanguage } from '../../i18n';
import { money } from '../../utils/format';

const ot = (k: string, o?: Record<string, unknown>) => t(`online.${k}`, o);

export function PayReturn() {
  useLanguage();
  const router = useRouter();
  const p = useLocalSearchParams<{ checkout?: string; cancelled?: string }>();
  const id = Number(p.checkout);
  const [c, setC] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!id) { setErr(t('errors.generic')); setBusy(false); return; }
    setBusy(true); setErr(null);
    try { setC(await onlineApi.confirm(id, p.cancelled === '1')); } catch (e) {
      setErr(errorMessage(e));
      try { setC(await onlineApi.get(id)); } catch { /* sin acceso o sin red */ }
    } finally { setBusy(false); }
  }, [id, p.cancelled]);

  useEffect(() => { check(); }, [check]);

  // Mientras está en proceso, se revisa solo cada pocos segundos (un rato)
  useEffect(() => {
    if (!c || !['created', 'pending'].includes(c.status)) return undefined;
    let n = 0;
    const tm = setInterval(() => { n += 1; if (n > 8) { clearInterval(tm); return; } onlineApi.get(id).then(setC).catch(() => {}); }, 4000);
    return () => clearInterval(tm);
  }, [c?.status, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (busy && !c) return <Loading label={ot('r_checking')} />;

  const view: { icon: IconName; color: string; title: string; body: string } = !c
    ? { icon: 'alert-circle', color: palette.danger, title: ot('r_failed'), body: ot('r_failedBody') }
    : c.status === 'completed' ? { icon: 'check-circle', color: palette.success, title: ot('r_completed'), body: ot('r_completedBody', { amount: money(c.total, c.currency) }) }
    : c.status === 'pending' ? { icon: 'clock', color: palette.warning, title: ot('r_pending'), body: ot('r_pendingBody') }
    : c.status === 'cancelled' ? { icon: 'x-circle', color: palette.ink2, title: ot('r_cancelled'), body: ot('r_cancelledBody') }
    : c.status === 'created' ? { icon: 'clock', color: palette.ink2, title: ot('r_waiting'), body: ot('r_waitingBody') }
    : { icon: 'alert-circle', color: palette.danger, title: ot('r_failed'), body: ot('r_failedBody') };

  return (
    <Screen maxWidth={560}>
      <Card style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
        <Icon name={view.icon} size={48} color={view.color} />
        <Text variant="title" align="center" accessibilityRole="header">{view.title}</Text>
        <Text align="center" color={palette.ink2}>{view.body}</Text>
        {c?.test_mode ? <Text variant="caption" color={palette.ink2}>{ot('testMode')}</Text> : null}
        {err && c?.status !== 'completed' ? <Notice tone="danger">{err}</Notice> : null}
        <View style={{ gap: space.xs, alignSelf: 'stretch' }}>
          {c && ['created', 'pending'].includes(c.status) ? (
            <Button label={ot('r_retry')} variant="secondary" icon="refresh-cw" loading={busy} onPress={check} fullWidth />
          ) : null}
          <Button label={ot('r_back')} variant="dark" icon="credit-card" onPress={() => router.replace('/payments')} fullWidth />
        </View>
      </Card>
    </Screen>
  );
}
