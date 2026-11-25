/** Alumno/tutor: elegir cargos pendientes y pagarlos con PayPal o Mercado Pago */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { feeFor, onlineApi, type OnlineOption, type Provider } from '../../api/online';
import { errorMessage } from '../../utils/errors';
import { Button, Card, Divider, Icon, Notice, SectionHeader, Text } from '../../ui/primitives';
import { useIsWide } from '../../navigation/AppShell';
import { palette, radius, space } from '../../theme/tokens';
import { t } from '../../i18n';
import { money } from '../../utils/format';

const ot = (k: string, o?: Record<string, unknown>) => t(`online.${k}`, o);
type OpenCharge = { id: number; description: string; balance: number; currency: string; note?: string; noteDanger?: boolean };

function Check({ on }: { on: boolean }) {
  return (
    <View style={{
      width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? palette.ink : palette.line,
      backgroundColor: on ? palette.ink : 'transparent', alignItems: 'center', justifyContent: 'center',
    }}>
      {on ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
    </View>
  );
}

export function PayOnline({ options, charges, userId }: { options: OnlineOption[]; charges: OpenCharge[]; userId?: number }) {
  const wide = useIsWide();
  const router = useRouter();
  const [sel, setSel] = useState<Set<number>>(new Set(charges.map((c) => c.id)));
  const [busy, setBusy] = useState<Provider | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setSel(new Set(charges.map((c) => c.id))); }, [charges.map((c) => c.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = useMemo(() => Math.round(charges.filter((c) => sel.has(c.id)).reduce((s, c) => s + Number(c.balance), 0) * 100) / 100, [charges, sel]);
  const currency = charges[0]?.currency ?? 'MXN';
  const allOn = sel.size === charges.length;
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function pay(o: OnlineOption) {
    if (!sel.size) { setErr(ot('nothingSelected')); return; }
    setBusy(o.provider); setErr(null);
    try {
      const r = await onlineApi.checkout({ provider: o.provider, charge_ids: [...sel], user_id: userId });
      if (Platform.OS === 'web') {
        window.location.assign(r.redirect_url);
        return; // la página se va al proveedor
      }
      const res = await WebBrowser.openAuthSessionAsync(r.redirect_url, 'budodesk://pay/return');
      const qs = res.type === 'success' && res.url.includes('?') ? res.url.slice(res.url.indexOf('?')) : `?checkout=${r.checkout_id}&provider=${o.provider}`;
      router.push(`/pay/return${qs}` as never);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card style={{ gap: space.sm }}>
      <SectionHeader title={ot('payOnline')} action={charges.length > 1 ? (
        <Pressable accessibilityRole="button" onPress={() => setSel(allOn ? new Set() : new Set(charges.map((c) => c.id)))} hitSlop={8}>
          <Text variant="smallStrong" color={palette.ink2}>{ot('selectAll')}</Text>
        </Pressable>
      ) : undefined} />
      <Text variant="small" color={palette.ink2}>{ot('payOnlineHint')}</Text>
      {charges.map((c, i) => (
        <View key={c.id}>
          {i > 0 ? <Divider /> : null}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: sel.has(c.id) }} onPress={() => toggle(c.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
            <Check on={sel.has(c.id)} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2}>{c.description}</Text>
              {c.note ? <Text variant="caption" color={c.noteDanger ? palette.danger : palette.ink2}>{c.note}</Text> : null}
            </View>
            <Text variant="bodyStrong">{money(c.balance, c.currency)}</Text>
          </Pressable>
        </View>
      ))}
      <View style={{ backgroundColor: palette.sunken, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
        {options.map((o) => {
          const fee = feeFor(subtotal, o.fee);
          return (
            <View key={o.provider} style={{ gap: 6 }}>
              {fee > 0 ? (
                <View style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="small">{ot('subtotal')}</Text><Text variant="small">{money(subtotal, currency)}</Text></View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="small">{ot('feeLine')} ({o.name})</Text><Text variant="small">{money(fee, currency)}</Text></View>
                </View>
              ) : null}
              <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: space.xs }}>
                <Text variant="bodyStrong" style={{ flex: wide ? 1 : undefined }}>{`${ot('total')}: ${money(subtotal + fee, currency)}`}</Text>
                <Button label={busy === o.provider ? ot('redirecting', { name: o.name }) : ot('payWith', { name: o.name })}
                  icon={o.provider === 'paypal' ? 'credit-card' : 'shopping-bag'} variant={o.provider === 'paypal' ? 'dark' : 'primary'}
                  loading={busy === o.provider} disabled={!!busy || !sel.size} onPress={() => pay(o)} fullWidth={!wide} />
              </View>
              {o.test_mode ? <Text variant="caption" color={palette.ink2}>{ot('testMode')}</Text> : null}
            </View>
          );
        })}
      </View>
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Card>
  );
}
