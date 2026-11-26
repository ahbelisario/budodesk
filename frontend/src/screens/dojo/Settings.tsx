/** Ajustes del dojo (admin): general, apariencia, clases y alta, cobro, legal y actividad */
import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { dojoApi, uploadLogo, type DojoSettings, type Location, type PaymentSettings } from '../../api/dojo';
import { API_URL } from '../../config';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Badge, Button, Card, Divider, EmptyState, Field, Icon, IconButton, Loading, Notice, SectionHeader, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { FormGrid, Select, SwitchRow, Tabs } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { onColor } from '../../theme/tokens';
import { t, useLanguage } from '../../i18n';
import { dateTimeShort, money } from '../../utils/format';
import { ColorField, isHex } from '../ranks/bits';
import { dt } from './Announcements';
import { OnlinePayments } from './OnlinePayments';

type Msg = { tone: 'success' | 'danger'; text: string } | null;
type TabKey = 'general' | 'look' | 'classes' | 'payments' | 'legal' | 'activity';
type S = Partial<DojoSettings>;

const TIMEZONES = ['America/Mexico_City', 'America/Monterrey', 'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana', 'America/Cancun',
  'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Madrid'];
const CURRENCIES = ['MXN', 'USD', 'COP', 'PEN', 'CLP', 'ARS', 'EUR'];

/** Guarda solo lo que cambió */
function useSettingsForm(base: DojoSettings | undefined) {
  const [v, setV] = useState<S>({});
  useEffect(() => { if (base) setV(base); }, [base]);
  const set = <K extends keyof DojoSettings>(k: K) => (x: DojoSettings[K] | null) => setV((o) => ({ ...o, [k]: x }));
  const txt = (k: keyof DojoSettings) => ({ value: (v[k] as string | null | undefined) ?? '', onChangeText: (x: string) => setV((o) => ({ ...o, [k]: x })) });
  const diff = () => {
    if (!base) return {};
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      let n = typeof val === 'string' ? val.trim() : val;
      if (n === '' && k !== 'name') n = null;
      if ((n ?? null) !== ((base as Record<string, unknown>)[k] ?? null)) out[k] = k === 'require_membership_to_book' ? !!n : n;
    }
    return out;
  };
  return { v, set, txt, diff };
}

function SaveBar({ busy, msg, onSave }: { busy: boolean; msg: Msg; onSave: () => void }) {
  return (
    <View style={{ gap: space.sm }}>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Button label={dt('save')} variant="dark" icon="check" loading={busy} onPress={onSave} style={{ alignSelf: 'flex-end' }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
function GeneralTab({ base, onSaved }: { base: DojoSettings; onSaved: (d: DojoSettings) => void }) {
  const f = useSettingsForm(base);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  async function save() {
    const body = f.diff();
    if (!f.v.name?.trim()) { setMsg({ tone: 'danger', text: dt('required') }); return; }
    if (!Object.keys(body).length) { setMsg({ tone: 'success', text: dt('saved') }); return; }
    setBusy(true); setMsg(null);
    try { onSaved(await dojoApi.updateSettings(body as never)); setMsg({ tone: 'success', text: dt('saved') }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('s_identity')}</Text>
        <FormGrid>
          <Field label={`${dt('f_name')} *`} {...f.txt('name')} />
          <Field label={dt('f_shortName')} {...f.txt('short_name')} hint={dt('f_shortNameHint')} maxLength={50} />
          <Field label={dt('f_legalName')} {...f.txt('legal_name')} />
          <Field label={dt('f_taxId')} {...f.txt('tax_id')} autoCapitalize="characters" />
        </FormGrid>
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('s_contact')}</Text>
        <FormGrid>
          <Field label={dt('f_phone')} {...f.txt('phone')} keyboardType="phone-pad" />
          <Field label={dt('f_email')} {...f.txt('email')} keyboardType="email-address" autoCapitalize="none" />
          <Field label={dt('f_website')} {...f.txt('website')} autoCapitalize="none" keyboardType="url" />
        </FormGrid>
        <Text variant="bodyStrong">{dt('s_social')}</Text>
        <FormGrid>
          <Field label={dt('f_facebook')} {...f.txt('facebook_url')} autoCapitalize="none" />
          <Field label={dt('f_instagram')} {...f.txt('instagram_url')} autoCapitalize="none" />
          <Field label={dt('f_tiktok')} {...f.txt('tiktok_url')} autoCapitalize="none" />
        </FormGrid>
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('s_address')}</Text>
        <FormGrid>
          <Field label={dt('f_address1')} {...f.txt('address_line1')} />
          <Field label={dt('f_address2')} {...f.txt('address_line2')} />
          <Field label={dt('f_city')} {...f.txt('city')} />
          <Field label={dt('f_state')} {...f.txt('state')} />
          <Field label={dt('f_postal')} {...f.txt('postal_code')} />
          <Field label={dt('f_country')} {...f.txt('country_code')} autoCapitalize="characters" maxLength={2} />
        </FormGrid>
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('s_region')}</Text>
        <FormGrid>
          <Select label={dt('f_timezone')} value={f.v.timezone ?? null} onChange={(x) => x && f.set('timezone')(x)}
            options={[...new Set([base.timezone, ...TIMEZONES])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))} />
          <Select label={dt('f_currency')} value={f.v.currency ?? null} onChange={(x) => x && f.set('currency')(x)}
            options={[...new Set([base.currency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} />
          <Select label={dt('f_language')} value={f.v.language ?? null} onChange={(x) => x && f.set('language')(x)}
            options={[{ value: 'es', label: dt('lang_es') }, { value: 'en', label: dt('lang_en') }]} />
        </FormGrid>
      </Card>
      <SaveBar busy={busy} msg={msg} onSave={save} />
    </View>
  );
}

// ---------------------------------------------------------------------------
function LookTab({ base, onSaved }: { base: DojoSettings; onSaved: (d: DojoSettings) => void }) {
  const f = useSettingsForm(base);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  const [logo, setLogo] = useState(base.logo_url);
  const [uploading, setUploading] = useState(false);
  const primary = isHex(f.v.color_primary) ? f.v.color_primary! : '#B71C1C';

  async function pickLogo() {
    setMsg(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setMsg({ tone: 'danger', text: t('members.photoPermission') }); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (res.canceled || !res.assets?.[0]) return;
    setUploading(true);
    try {
      const a = res.assets[0];
      const { url } = await uploadLogo(a.uri, a.mimeType ?? 'image/png');
      setLogo(url); onSaved({ ...base, logo_url: url }); setMsg({ tone: 'success', text: dt('logoUpdated') });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setUploading(false); }
  }
  async function save() {
    for (const k of ['color_primary', 'color_secondary', 'color_accent'] as const) {
      if (f.v[k] && !isHex(f.v[k])) { setMsg({ tone: 'danger', text: t('ranks.f_colorHint') }); return; }
    }
    const body = f.diff();
    if (!Object.keys(body).length) { setMsg({ tone: 'success', text: dt('saved') }); return; }
    setBusy(true); setMsg(null);
    try { onSaved(await dojoApi.updateSettings(body as never)); setMsg({ tone: 'success', text: dt('saved') }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  const logoSrc = logo ? (logo.startsWith('http') ? logo : `${API_URL}${logo}`) : null;

  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('logo')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
          <View style={{ width: 88, height: 88, borderRadius: radius.lg, backgroundColor: logoSrc ? palette.surface : primary, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {logoSrc ? <Image source={{ uri: logoSrc }} style={{ width: 80, height: 80 }} resizeMode="contain" accessibilityLabel={dt('logo')} />
              : <Text style={{ fontSize: 36 }} color={onColor(primary)}>{(base.short_name ?? base.name).slice(0, 1).toUpperCase()}</Text>}
          </View>
          <View style={{ gap: 6, flex: 1, minWidth: 200 }}>
            <Button label={dt('changeLogo')} size="sm" variant="secondary" icon="image" loading={uploading} onPress={pickLogo} style={{ alignSelf: 'flex-start' }} />
            <Text variant="small" color={palette.ink2}>{dt('logoHint')}</Text>
          </View>
        </View>
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('colors')}</Text>
        <Text variant="small" color={palette.ink2}>{dt('colorsHint')}</Text>
        <FormGrid>
          <ColorField label={dt('f_primary')} value={f.v.color_primary ?? null} onChange={(x) => f.set('color_primary')(x)} />
          <ColorField label={dt('f_secondary')} value={f.v.color_secondary ?? null} onChange={(x) => f.set('color_secondary')(x)} allowEmpty />
        </FormGrid>
        <View style={{ gap: space.xs }}>
          <Text variant="caption" color={palette.ink2}>{dt('preview')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <View style={{ backgroundColor: primary, borderRadius: radius.pill, paddingHorizontal: 18, height: 40, justifyContent: 'center' }}>
              <Text variant="bodyStrong" color={onColor(primary)}>{dt('previewButton')}</Text>
            </View>
            <View style={{ borderBottomWidth: 2, borderBottomColor: primary, paddingBottom: 4 }}><Text variant="bodyStrong">{t('nav.classes')}</Text></View>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: primary }} />
          </View>
        </View>
      </Card>
      <SaveBar busy={busy} msg={msg} onSave={save} />
    </View>
  );
}

// ---------------------------------------------------------------------------
function LocationsCard() {
  const data = useApi(() => dojoApi.locations(), []);
  const [dlg, setDlg] = useState<{ open: boolean; loc: Location | null }>({ open: false, loc: null });
  const [name, setName] = useState(''); const [address, setAddress] = useState(''); const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  function open(loc: Location | null) { setDlg({ open: true, loc }); setName(loc?.name ?? ''); setAddress(loc?.address ?? ''); setActive(loc ? !!loc.active : true); setErr(null); }
  async function save() {
    if (!name.trim()) { setErr(dt('required')); return; }
    setBusy(true); setErr(null);
    try {
      if (dlg.loc) await dojoApi.updateLocation(dlg.loc.id, { name: name.trim(), address: address.trim() || null, active });
      else await dojoApi.createLocation({ name: name.trim(), address: address.trim() || null });
      setDlg({ open: false, loc: null }); data.reload();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card style={{ gap: space.sm }}>
      <SectionHeader title={dt('locations')} action={<Button label={dt('newLocation')} size="sm" variant="secondary" icon="plus" onPress={() => open(null)} />} />
      <Text variant="small" color={palette.ink2}>{dt('locationsHint')}</Text>
      {data.loading ? <Loading /> : (data.data ?? []).length === 0 ? <Text color={palette.ink2}>{dt('noLocations')}</Text> : (data.data ?? []).map((l, i) => (
        <View key={l.id}>
          {i > 0 ? <Divider /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, opacity: l.active ? 1 : 0.55 }}>
            <Icon name="map-pin" size={16} color={palette.ink2} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyStrong">{l.name}</Text>
              {l.address ? <Text variant="caption" color={palette.ink2}>{l.address}</Text> : null}
            </View>
            {!l.active ? <Badge label={dt('inactive')} /> : null}
            <IconButton icon="edit-2" label={dt('editLocation')} size="sm" onPress={() => open(l)} />
          </View>
        </View>
      ))}
      <Dialog visible={dlg.open} title={dlg.loc ? dt('editLocation') : dt('newLocation')} onClose={() => setDlg({ open: false, loc: null })}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setDlg({ open: false, loc: null })} /><Button label={t('common.save')} loading={busy} onPress={save} /></>}>
        <Field label={`${dt('l_name')} *`} value={name} onChangeText={setName} />
        <Field label={dt('l_address')} value={address} onChangeText={setAddress} />
        {dlg.loc ? <SwitchRow label={dt('l_active')} value={active} onChange={setActive} /> : null}
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </Dialog>
    </Card>
  );
}

function ClassesTab({ base, onSaved }: { base: DojoSettings; onSaved: (d: DojoSettings) => void }) {
  const f = useSettingsForm(base);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  async function save() {
    const body = f.diff();
    for (const k of ['booking_window_days', 'booking_cancel_hours']) if (k in body) body[k] = Number(body[k] ?? 0);
    if (!Object.keys(body).length) { setMsg({ tone: 'success', text: dt('saved') }); return; }
    setBusy(true); setMsg(null);
    try { onSaved(await dojoApi.updateSettings(body as never)); setMsg({ tone: 'success', text: dt('saved') }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  const numTxt = (k: 'booking_window_days' | 'booking_cancel_hours') => ({
    value: f.v[k] != null ? String(f.v[k]) : '', onChangeText: (x: string) => f.set(k)(x.replace(/\D/g, '') === '' ? (null as never) : (Number(x.replace(/\D/g, '')) as never)),
  });
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('booking')}</Text>
        <FormGrid>
          <Field label={dt('f_window')} {...numTxt('booking_window_days')} keyboardType="number-pad" />
          <Field label={dt('f_cancelHours')} {...numTxt('booking_cancel_hours')} keyboardType="number-pad" hint={dt('f_cancelHoursHint')} />
        </FormGrid>
        <SwitchRow label={dt('f_requireMembership')} hint={dt('f_requireMembershipHint')} value={!!f.v.require_membership_to_book}
          onChange={(x) => f.set('require_membership_to_book')((x ? 1 : 0) as never)} />
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('signup')}</Text>
        <Select label={dt('f_selfReg')} value={f.v.self_registration ?? null} onChange={(x) => x && f.set('self_registration')(x)}
          options={(['closed', 'approval', 'open'] as const).map((k) => ({ value: k, label: dt(`reg_${k}`) }))} />
      </Card>
      <SaveBar busy={busy} msg={msg} onSave={save} />
      <LocationsCard />
    </View>
  );
}

// ---------------------------------------------------------------------------
function PaymentsTab() {
  const data = useApi(() => dojoApi.paymentSettings(), []);
  const [v, setV] = useState<Partial<PaymentSettings>>({});
  const [fee, setFee] = useState(''); const [grace, setGrace] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (!data.data) return;
    setV(data.data); setFee(data.data.late_fee_amount != null ? String(data.data.late_fee_amount) : ''); setGrace(data.data.late_fee_grace_days != null ? String(data.data.late_fee_grace_days) : '');
  }, [data.data]);
  if (data.loading) return <Loading />;
  async function save() {
    setBusy(true); setMsg(null);
    try {
      await dojoApi.updatePaymentSettings({
        accepts_cash: !!v.accepts_cash, accepts_transfer: !!v.accepts_transfer, transfer_instructions: v.transfer_instructions?.trim() || null,
        late_fee_amount: fee.trim() ? Number(fee.replace(',', '.')) : null, late_fee_grace_days: grace.trim() ? Number(grace) : null,
        auto_charges: v.auto_charges !== 0, payment_reminders: v.payment_reminders !== 0,
      });
      setMsg({ tone: 'success', text: dt('saved') });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.sm }}>
        <Text variant="bodyStrong">{dt('paymentMethods')}</Text>
        <SwitchRow label={dt('f_cash')} value={!!v.accepts_cash} onChange={(x) => setV({ ...v, accepts_cash: x ? 1 : 0 })} />
        <SwitchRow label={dt('f_transfer')} value={!!v.accepts_transfer} onChange={(x) => setV({ ...v, accepts_transfer: x ? 1 : 0 })} />
        {v.accepts_transfer ? (
          <Field label={dt('f_transferInstructions')} value={v.transfer_instructions ?? ''} onChangeText={(x) => setV({ ...v, transfer_instructions: x })} multiline
            hint={dt('f_transferInstructionsHint')} style={{ minHeight: 96, paddingVertical: 12, textAlignVertical: 'top' }} />
        ) : null}
      </Card>
      <Card style={{ gap: space.sm }}>
        <Text variant="bodyStrong">{dt('automation')}</Text>
        <SwitchRow label={dt('f_autoCharges')} hint={dt(v.auto_charges === 0 ? 'f_autoChargesOff' : 'f_autoChargesHint')}
          value={v.auto_charges !== 0} onChange={(x) => setV({ ...v, auto_charges: x ? 1 : 0 })} />
        <SwitchRow label={dt('f_reminders')} hint={dt('f_remindersHint')}
          value={v.payment_reminders !== 0} onChange={(x) => setV({ ...v, payment_reminders: x ? 1 : 0 })} />
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('lateFees')}</Text>
        <FormGrid>
          <Field label={dt('f_lateFee')} value={fee} onChangeText={(x) => setFee(x.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" hint={fee ? money(Number(fee.replace(',', '.'))) : dt('f_lateFeeHint')} />
          <Field label={dt('f_graceDays')} value={grace} onChangeText={(x) => setGrace(x.replace(/\D/g, ''))} keyboardType="number-pad" hint={dt('f_graceDaysHint')} />
        </FormGrid>
      </Card>
      <SaveBar busy={busy} msg={msg} onSave={save} />
      {data.data ? <OnlinePayments settings={data.data} onSaved={(d) => data.setData(d)} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
function LegalTab({ base, onSaved }: { base: DojoSettings; onSaved: (d: DojoSettings) => void }) {
  const f = useSettingsForm(base);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<Msg>(null);
  async function save() {
    const body = f.diff();
    if (!Object.keys(body).length) { setMsg({ tone: 'success', text: dt('saved') }); return; }
    setBusy(true); setMsg(null);
    try { onSaved(await dojoApi.updateSettings(body as never)); setMsg({ tone: 'success', text: dt('saved') }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  const area = { multiline: true, style: { minHeight: 220, paddingVertical: 12, textAlignVertical: 'top' as const } };
  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('privacy')}</Text>
        <View style={{ maxWidth: 260 }}><Field label={dt('f_privacyVersion')} {...f.txt('privacy_version')} hint={dt('f_privacyVersionHint')} maxLength={10} /></View>
        <Field label={dt('privacy')} {...f.txt('privacy_policy')} {...area} />
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong">{dt('terms')}</Text>
        <Field label={dt('terms')} {...f.txt('terms_conditions')} {...area} />
      </Card>
      <SaveBar busy={busy} msg={msg} onSave={save} />
    </View>
  );
}

// ---------------------------------------------------------------------------
function ActivityTab() {
  const data = useApi(() => dojoApi.auditLog(80), []);
  if (data.loading) return <Loading />;
  const rows = data.data ?? [];
  return (
    <Card style={{ gap: space.xs }}>
      <SectionHeader title={dt('activity')} />
      <Text variant="small" color={palette.ink2}>{dt('activityHint')}</Text>
      {rows.length === 0 ? <EmptyState icon="activity" title={dt('noActivity')} /> : rows.map((r, i) => (
        <View key={r.id}>
          {i > 0 ? <Divider /> : null}
          <View style={{ paddingVertical: space.xs, gap: 2 }}>
            <Text variant="body">
              {r.platform ? <Text variant="smallStrong" color={palette.ink2}>{`${dt('platformEntry')} · `}</Text> : null}
              <Text variant="bodyStrong">{r.user_name ?? (r.platform ? 'BudoDesk' : '—')}</Text> · {r.action} · {r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}
            </Text>
            <Text variant="caption" color={palette.ink2}>{dateTimeShort(r.created_at)}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
export function Settings() {
  useLanguage();
  const { reload } = useSession();
  const data = useApi(() => dojoApi.settings(), []);
  const [tab, setTab] = useState<TabKey>('general');
  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <Screen><Notice tone="danger">{data.error ?? ''}</Notice></Screen>;
  // Al guardar, se refresca la sesión para que cambien nombre, logo y colores en toda la app
  const onSaved = (d: DojoSettings) => { data.setData(d); reload().catch(() => {}); };

  return (
    <Screen maxWidth={900}>
      <Text variant="title" accessibilityRole="header">{dt('settings')}</Text>
      <Tabs value={tab} onChange={setTab} tabs={(['general', 'look', 'classes', 'payments', 'legal', 'activity'] as const).map((k) => ({ key: k, label: dt(`tab_${k}`) }))} />
      <View key={tab}>
        {tab === 'general' ? <GeneralTab base={data.data} onSaved={onSaved} /> : null}
        {tab === 'look' ? <LookTab base={data.data} onSaved={onSaved} /> : null}
        {tab === 'classes' ? <ClassesTab base={data.data} onSaved={onSaved} /> : null}
        {tab === 'payments' ? <PaymentsTab /> : null}
        {tab === 'legal' ? <LegalTab base={data.data} onSaved={onSaved} /> : null}
        {tab === 'activity' ? <ActivityTab /> : null}
      </View>
    </Screen>
  );
}
