/** Ajustes → Cobro: PayPal y Mercado Pago (credenciales del dojo, ambiente, comisión al alumno) */
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { dojoApi, type CredSlot, type OnlineSettingsPatch, type PaymentSettings } from '../../api/dojo';
import { feeFor } from '../../api/online';
import { errorMessage } from '../../utils/errors';
import { Button, Card, Field, Notice, Text } from '../../ui/primitives';
import { FormGrid, Select, SwitchRow, Tabs } from '../../ui/forms';
import { useIsWide } from '../../navigation/AppShell';
import { palette, radius, space } from '../../theme/tokens';
import { t } from '../../i18n';
import { money } from '../../utils/format';

const ot = (k: string, o?: Record<string, unknown>) => t(`online.${k}`, o);
type Msg = { tone: 'success' | 'danger'; text: string } | null;
type P = 'paypal' | 'mercadopago';
const NAMES: Record<P, string> = { paypal: 'PayPal', mercadopago: 'Mercado Pago' };

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const str = (n: number | null | undefined) => (n == null ? '' : String(Number(n)));

function CopyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.clipboard;
  return (
    <Pressable accessibilityRole={canCopy ? 'button' : undefined} accessibilityLabel={ot('copy')}
      onPress={async () => { if (canCopy) { await navigator.clipboard.writeText(value); setCopied(true); } }}
      style={{ backgroundColor: palette.sunken, borderRadius: radius.md, padding: space.sm, gap: 2 }}>
      <Text variant="small" selectable style={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) }}>{value}</Text>
      {canCopy ? <Text variant="caption" color={palette.ink2}>{copied ? ot('copied') : ot('copy')}</Text> : null}
    </Pressable>
  );
}

type Cred = { id: string; secret: string; hook: string; hookSecret: string };
const slotOf = (mode: string): CredSlot => (mode === 'live' ? 'live' : 'test');
const SLOTS: CredSlot[] = ['test', 'live'];

function ProviderCard({ provider, s, onSaved }: { provider: P; s: PaymentSettings; onSaved: (d: PaymentSettings) => void }) {
  const wide = useIsWide();
  const pp = provider === 'paypal';
  const pre = pp ? 'paypal' : 'mp';
  const g = (slot: CredSlot, k: string) => s[`${pre}_${slot}_${k}` as keyof PaymentSettings] as string | number | null | undefined;
  const credsFrom = (): Record<CredSlot, Cred> => Object.fromEntries(SLOTS.map((k) => [k, {
    id: String(g(k, pp ? 'client_id' : 'public_key') ?? ''), secret: '', hook: pp ? String(g(k, 'webhook_id') ?? '') : '', hookSecret: '',
  }])) as Record<CredSlot, Cred>;
  const modeFrom = () => (pp ? s.paypal_mode : s.mp_mode) || (pp ? 'sandbox' : 'test');

  const [on, setOn] = useState(!!(pp ? s.paypal_enabled : s.mp_enabled));
  const [mode, setMode] = useState<string>(modeFrom());
  const [tab, setTab] = useState<CredSlot>(slotOf(modeFrom()));
  const [creds, setCreds] = useState(credsFrom);
  const [pct, setPct] = useState(str(pp ? s.paypal_fee_percent : s.mp_fee_percent));
  const [fixed, setFixed] = useState(str(pp ? s.paypal_fee_fixed : s.mp_fee_fixed));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    setOn(!!(pp ? s.paypal_enabled : s.mp_enabled));
    setMode(modeFrom());
    setCreds((c) => {
      const fresh = credsFrom();
      // conserva lo que se esté escribiendo en los campos que no son secretos solo si no se guardó
      return Object.fromEntries(SLOTS.map((k) => [k, { ...fresh[k], secret: c[k].secret, hookSecret: c[k].hookSecret }])) as Record<CredSlot, Cred>;
    });
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const disabled = s.encryption_available === false;
  const live = mode === 'live';
  const activeSlot = slotOf(mode);
  const cur = creds[tab];
  const setCur = (patch: Partial<Cred>) => setCreds((c) => ({ ...c, [tab]: { ...c[tab], ...patch } }));
  const secretSet = !!g(tab, pp ? 'secret_set' : 'access_token_set');
  const hookSecretSet = !pp && !!g(tab, 'webhook_secret_set');

  function body(): OnlineSettingsPatch {
    const b: Record<string, unknown> = {
      [`${pre}_enabled`]: on, [`${pre}_mode`]: mode,
      [`${pre}_fee_percent`]: num(pct), [`${pre}_fee_fixed`]: num(fixed),
    };
    for (const k of SLOTS) {
      const c = creds[k];
      if (pp) {
        b[`paypal_${k}_client_id`] = c.id.trim() || null;
        b[`paypal_${k}_webhook_id`] = c.hook.trim() || null;
        if (c.secret.trim()) b[`paypal_${k}_secret`] = c.secret.trim();
      } else {
        b[`mp_${k}_public_key`] = c.id.trim() || null;
        if (c.secret.trim()) b[`mp_${k}_access_token`] = c.secret.trim();
        if (c.hookSecret.trim()) b[`mp_${k}_webhook_secret`] = c.hookSecret.trim();
      }
    }
    return b as OnlineSettingsPatch;
  }
  async function save() {
    setBusy('save'); setMsg(null);
    try {
      onSaved(await dojoApi.updateOnlineSettings(body()));
      setCreds((c) => Object.fromEntries(SLOTS.map((k) => [k, { ...c[k], secret: '', hookSecret: '' }])) as Record<CredSlot, Cred>);
      setMsg({ tone: 'success', text: ot('saved') });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(null); }
  }
  async function test() {
    setBusy('test'); setMsg(null);
    try {
      const r = await dojoApi.testProvider(provider, pp
        ? { mode: tab, client_id: cur.id.trim() || undefined, secret: cur.secret.trim() || undefined }
        : { mode: tab, access_token: cur.secret.trim() || undefined });
      const where = ot(tab === 'live' ? 'slot_live' : 'slot_test');
      setMsg({ tone: 'success', text: r.account ? ot('testOkAccount', { account: r.account, where }) : ot('testOk', { where }) });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(null); }
  }

  const pctN = num(pct) ?? 0; const fixedN = num(fixed) ?? 0;
  const exFee = feeFor(1000, { percent: pctN, fixed: fixedN });

  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyStrong">{NAMES[provider]}</Text>
      <Text variant="small" color={palette.ink2}>{ot(pp ? 'pp_help' : 'mp_help')}</Text>
      <SwitchRow label={ot('enabled', { name: NAMES[provider] })} value={on} disabled={disabled} onChange={setOn} />
      <Select label={ot('mode')} value={mode} disabled={disabled} onChange={(x) => x && setMode(x)}
        options={[{ value: pp ? 'sandbox' : 'test', label: ot(pp ? 'mode_sandbox' : 'mode_test') }, { value: 'live', label: ot('mode_live') }]} />
      <Text variant="small" color={palette.ink2}>{ot('modeHint')}</Text>

      <View style={{ gap: space.sm }}>
        <Tabs<CredSlot> value={tab} onChange={(k) => { setTab(k); setMsg(null); }} tabs={SLOTS.map((k) => ({
          key: k, label: `${ot(k === 'live' ? 'slot_live' : 'slot_test')}${k === activeSlot ? ` · ${ot('inUse')}` : ''}`,
        }))} />
        <Text variant="small" color={palette.ink2}>{ot(tab === activeSlot ? 'slotActive' : 'slotInactive', { where: ot(tab === 'live' ? 'slot_live' : 'slot_test') })}</Text>
        <FormGrid>
          <Field label={ot(pp ? 'pp_clientId' : 'mp_publicKey')} value={cur.id} editable={!disabled} autoCapitalize="none" autoCorrect={false}
            onChangeText={(x) => setCur({ id: x })} />
          <Field label={ot(pp ? 'pp_secret' : 'mp_accessToken')} value={cur.secret} editable={!disabled} secureTextEntry secureToggle
            autoCapitalize="none" autoCorrect={false} placeholder={secretSet ? '••••••••' : ''}
            hint={secretSet ? ot('secretSaved') : undefined} onChangeText={(x) => setCur({ secret: x })} />
          {pp ? (
            <Field label={ot('pp_webhookId')} value={cur.hook} editable={!disabled} autoCapitalize="none" autoCorrect={false}
              onChangeText={(x) => setCur({ hook: x })} />
          ) : (
            <Field label={ot('mp_webhookSecret')} value={cur.hookSecret} editable={!disabled} secureTextEntry secureToggle autoCapitalize="none"
              autoCorrect={false} placeholder={hookSecretSet ? '••••••••' : ''}
              hint={hookSecretSet ? ot('secretSaved') : undefined} onChangeText={(x) => setCur({ hookSecret: x })} />
          )}
        </FormGrid>
        <Text variant="small" color={palette.ink2}>{ot(pp ? 'pp_webhookIdHint' : 'mp_webhookSecretHint')}</Text>
        {s.webhook_urls ? (
          <View style={{ gap: 4 }}>
            <Text variant="smallStrong">{ot('webhookUrl', { where: ot(tab === 'live' ? 'slot_live' : 'slot_test') })}</Text>
            <CopyBox value={s.webhook_urls[provider][tab]} />
            <Text variant="caption" color={palette.ink2}>{ot('webhookUrlHint')}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: wide ? 'row' : 'column', justifyContent: 'flex-end' }}>
          <Button label={ot('test')} variant="secondary" icon="zap" loading={busy === 'test'} disabled={disabled} onPress={test} fullWidth={!wide} />
        </View>
      </View>

      <View style={{ gap: space.xs }}>
        <Text variant="smallStrong">{ot('fee')}</Text>
        <FormGrid>
          <Field label={ot('feePercent')} value={pct} editable={!disabled} keyboardType="decimal-pad" onChangeText={(x) => setPct(x.replace(/[^\d.,]/g, ''))} />
          <Field label={ot('feeFixed')} value={fixed} editable={!disabled} keyboardType="decimal-pad" onChangeText={(x) => setFixed(x.replace(/[^\d.,]/g, ''))} />
        </FormGrid>
        <Text variant="small" color={palette.ink2}>
          {exFee > 0 ? ot('feeExample', { base: money(1000), total: money(1000 + exFee), fee: money(exFee) }) : ot('feeHint')}
        </Text>
      </View>
      {on && live ? <Notice tone="warning">{ot('liveWarn')}</Notice> : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <View style={{ flexDirection: wide ? 'row' : 'column', justifyContent: 'flex-end' }}>
        <Button label={ot('save')} variant="dark" icon="check" loading={busy === 'save'} disabled={disabled} onPress={save} fullWidth={!wide} />
      </View>
    </Card>
  );
}

export function OnlinePayments({ settings, onSaved }: { settings: PaymentSettings; onSaved: (d: PaymentSettings) => void }) {
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: 4 }}>
        <Text variant="heading">{ot('s_title')}</Text>
        <Text variant="small" color={palette.ink2}>{ot('s_intro')}</Text>
      </View>
      {settings.encryption_available === false ? <Notice tone="warning">{ot('s_noKey')}</Notice> : null}
      <ProviderCard provider="paypal" s={settings} onSaved={onSaved} />
      <ProviderCard provider="mercadopago" s={settings} onSaved={onSaved} />
    </View>
  );
}
