/** Panel de la plataforma (solo superadmin): dojos, solicitudes de registro y respaldos */
import React, { useEffect, useMemo, useState } from 'react';
import { Platform as RNPlatform, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  downloadBackup, fileSize, platformApi, type Backup, type BackupSettings, type DojoPlan, type DojoStatus,
  type NewDojo, type PlatformDojo, type SettingsPatch,
} from '../../api/platform';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Badge, Button, Card, EmptyState, Field, Icon, Loading, Notice, Text, type Tone } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, FormGrid, Select, SwitchRow, Tabs } from '../../ui/forms';
import { useIsWide } from '../../navigation/AppShell';
import { palette, radius, space } from '../../theme/tokens';
import { getLanguage, t, useLanguage } from '../../i18n';
import { dateTimeShort, dayShort, dayLong } from '../../utils/format';
import { signupApi, type Signup, type SignupSettings, type SignupStatus } from '../../api/signup';
import { dojoHost } from '../../config';
import { FilterChips } from '../../ui/forms';

const pt = (k: string, o?: Record<string, unknown>) => t(`platform.${k}`, o);
type Msg = { tone: 'success' | 'danger'; text: string } | null;
type TabKey = 'dojos' | 'signups' | 'backups';

const TIMEZONES = ['America/Mexico_City', 'America/Monterrey', 'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana',
  'America/Cancun', 'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Madrid'];
const CURRENCIES = ['MXN', 'USD', 'COP', 'PEN', 'CLP', 'ARS', 'EUR'];
const PLANS: DojoPlan[] = ['trial', 'basic', 'pro'];
const STATUS_TONE: Record<DojoStatus, Tone> = { trial: 'info', active: 'success', expired: 'warning', suspended: 'warning', cancelled: 'danger' };
const tzOptions = (cur?: string | null) => [...new Set([...(cur ? [cur] : []), ...TIMEZONES])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') }));
const DOMAIN = 'budodesk.com';

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Fecha local ('AAAA-MM-DD HH:MM') del servidor → texto legible */
function localWhen(s: string) {
  const [d, time] = s.split(' ');
  return `${dayShort(d)}, ${time}`;
}

function weekdayName(i: number) {
  // 4 ene 2026 fue domingo
  return new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'es-MX', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, 0, 4 + i)));
}

async function copyText(text: string) {
  if (RNPlatform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

// ===========================================================================
// Dojos
// ===========================================================================
function DojoCard({ d, current, onEnter, onEdit, entering }: {
  d: PlatformDojo; current: boolean; onEnter: () => void; onEdit: () => void; entering: boolean;
}) {
  const wide = useIsWide();
  const color = d.color_primary || palette.ink;
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 11, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="bodyStrong" color="#FFFFFF">{(d.short_name || d.name)[0]?.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>{d.name}</Text>
          <Text variant="small" color={palette.ink2} numberOfLines={1}>{`${d.slug}.${DOMAIN}`}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
        <Badge label={pt(`status_${d.status}`)} tone={STATUS_TONE[d.status]} />
        <Badge label={pt(`plan_${d.plan}`)} tone="neutral" />
        {d.is_member ? <Badge label={pt('youAreMember')} tone="neutral" /> : null}
        {current ? <Badge label="✓" tone="dark" /> : null}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="small" color={palette.ink2}>
          {`${pt('members', { count: d.members_active })} · ${pt('students', { count: d.students_active })}`}
        </Text>
        <Text variant="small" color={palette.ink2} numberOfLines={2}>
          {d.owners ? pt('owner', { name: d.owners }) : pt('noOwner')}
          {d.owner_emails ? ` (${d.owner_emails})` : ''}
        </Text>
        <Text variant="small" color={palette.ink2}>
          {d.last_activity ? pt('lastActivity', { when: dateTimeShort(d.last_activity) }) : pt('noActivity')}
          {d.status === 'trial' && d.trial_ends_at ? ` · ${pt('trialUntil', { date: dayShort(String(d.trial_ends_at).slice(0, 10)) })}` : ''}
          {d.status === 'expired' && d.trial_ends_at ? ` · ${pt('trialEnded', { date: dayShort(String(d.trial_ends_at).slice(0, 10)) })}` : ''}
        </Text>
      </View>
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs, justifyContent: 'flex-end' }}>
        <Button label={pt('edit')} variant="secondary" size="sm" icon="edit-2" onPress={onEdit} fullWidth={!wide} />
        {!current ? (
          <Button label={pt('enter')} accessibilityHint={pt('enterHint')} variant="dark" size="sm" icon="log-in"
            loading={entering} onPress={onEnter} fullWidth={!wide} />
        ) : null}
      </View>
    </Card>
  );
}

function NewDojoDialog({ visible, onClose, onCreated, dojos, defaultCopy }: {
  visible: boolean; onClose: () => void; onCreated: (msg: string) => void; dojos: PlatformDojo[]; defaultCopy: number | null;
}) {
  const blank = (): NewDojo => ({
    name: '', short_name: '', slug: '', timezone: 'America/Mexico_City', currency: 'MXN', language: 'es', country_code: 'MX',
    plan: 'trial', status: 'trial', trial_ends_at: null, owner_email: '', owner_first_name: '', owner_last_name: '',
    copy_from_dojo_id: defaultCopy, send_owner_email: true,
  });
  const [v, setV] = useState<NewDojo>(blank);
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (visible) { setV(blank()); setSlugTouched(false); setErr(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof NewDojo>(k: K) => (x: NewDojo[K]) => setV((o) => ({ ...o, [k]: x }));
  const onName = (name: string) => setV((o) => ({ ...o, name, slug: slugTouched ? o.slug : slugify(name) }));

  async function create() {
    if (!v.name.trim() || !v.slug.trim() || !v.owner_email.trim() || !v.owner_first_name.trim()) { setErr(pt('required')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await platformApi.createDojo({
        ...v, short_name: v.short_name?.trim() || null, owner_last_name: v.owner_last_name?.trim() || null,
        trial_ends_at: v.status === 'trial' ? v.trial_ends_at || null : null,
      });
      const parts = [
        pt('created', { name: r.dojo.name }),
        r.owner.created ? pt('createdOwnerNew', { email: r.owner.email }) : pt('createdOwnerLinked', { email: r.owner.email }),
        r.owner.email_sent ? pt('createdEmailSent') : pt('createdEmailNot'),
      ];
      if (r.copied.disciplines !== undefined) parts.push(pt('createdCopied', r.copied));
      onCreated(parts.join(' '));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog visible={visible} title={pt('newDojo')} onClose={onClose} wide
      actions={<>
        <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
        <Button label={pt('create')} variant="dark" icon="plus" loading={busy} onPress={create} />
      </>}>
      <Text variant="bodyStrong">{pt('s_dojo')}</Text>
      <FormGrid>
        <Field label={`${pt('f_name')} *`} value={v.name} onChangeText={onName} />
        <Field label={pt('f_shortName')} value={v.short_name ?? ''} onChangeText={set('short_name')} maxLength={50} />
        <Field label={`${pt('f_slug')} *`} value={v.slug} autoCapitalize="none" autoCorrect={false}
          onChangeText={(x) => { setSlugTouched(true); set('slug')(slugify(x)); }}
          hint={v.slug ? pt('f_slugHint', { url: `${v.slug}.${DOMAIN}` }) : undefined} />
        <Select label={pt('f_timezone')} value={v.timezone} onChange={(x) => x && set('timezone')(x)} options={tzOptions(v.timezone)} />
        <Select label={pt('f_currency')} value={v.currency} onChange={(x) => x && set('currency')(x)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Select label={pt('f_language')} value={v.language} onChange={(x) => x && set('language')(x)}
          options={[{ value: 'es', label: pt('lang_es') }, { value: 'en', label: pt('lang_en') }]} />
        <Field label={pt('f_country')} value={v.country_code} maxLength={2} autoCapitalize="characters"
          onChangeText={(x) => set('country_code')(x.toUpperCase())} />
        <Select label={pt('f_plan')} value={v.plan} onChange={(x) => x && set('plan')(x)} options={PLANS.map((p) => ({ value: p, label: pt(`plan_${p}`) }))} />
        <Select label={pt('f_status')} value={v.status} onChange={(x) => x && set('status')(x)}
          options={(['trial', 'active'] as const).map((s) => ({ value: s, label: pt(`status_${s}`) }))} />
        {v.status === 'trial' ? (
          <DateField label={pt('f_trialEnds')} value={v.trial_ends_at} onChange={(x) => set('trial_ends_at')(x)} hint={pt('f_trialEndsHint')} />
        ) : null}
      </FormGrid>

      <Text variant="bodyStrong">{pt('s_owner')}</Text>
      <FormGrid>
        <Field label={`${pt('f_ownerEmail')} *`} value={v.owner_email} onChangeText={set('owner_email')}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        <Field label={`${pt('f_ownerFirst')} *`} value={v.owner_first_name} onChangeText={set('owner_first_name')} />
        <Field label={pt('f_ownerLast')} value={v.owner_last_name ?? ''} onChangeText={set('owner_last_name')} />
      </FormGrid>
      <SwitchRow label={pt('f_sendEmail')} hint={pt('f_sendEmailHint')} value={v.send_owner_email} onChange={set('send_owner_email')} />

      <Text variant="bodyStrong">{pt('s_setup')}</Text>
      <Select label={pt('f_copyFrom')} value={v.copy_from_dojo_id ?? 0}
        onChange={(x) => set('copy_from_dojo_id')(x ? Number(x) : null)}
        options={[{ value: 0, label: pt('copyNone') }, ...dojos.map((d) => ({ value: d.id, label: d.name }))]} />
      <Text variant="small" color={palette.ink2}>{pt('f_copyFromHint')}</Text>
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

/** Eliminar un dojo cancelado: hay que escribir su dirección para confirmar */
function DeleteDojoSection({ dojo, onDeleted }: { dojo: PlatformDojo; onDeleted: (msg: string) => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (dojo.status !== 'cancelled') {
    return <Text variant="small" color={palette.ink2}>{pt('deleteNeedsCancel')}</Text>;
  }
  async function del() {
    setBusy(true); setErr(null);
    try {
      const r = await platformApi.deleteDojo(dojo.id, confirm.trim());
      onDeleted(pt('deleted', { name: r.name, members: pt('members', { count: r.members }), accounts: pt('accountsCount', { count: r.accounts_deleted }) }));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: space.sm, borderWidth: 1, borderColor: palette.danger, borderRadius: radius.md, padding: space.md }}>
      <Text variant="bodyStrong" color={palette.danger}>{pt('deleteTitle')}</Text>
      <Text variant="small">{pt('deleteBody')}</Text>
      <Field label={pt('deleteConfirm', { slug: dojo.slug })} value={confirm} onChangeText={setConfirm}
        autoCapitalize="none" autoCorrect={false} />
      {err ? <Notice tone="danger">{err}</Notice> : null}
      <Button label={pt('deleteButton')} variant="danger" icon="trash-2" loading={busy}
        disabled={confirm.trim() !== dojo.slug} onPress={del} />
    </View>
  );
}

function EditDojoDialog({ dojo, onClose, onSaved, onDeleted }: {
  dojo: PlatformDojo | null; onClose: () => void; onSaved: (d: PlatformDojo) => void; onDeleted: (msg: string) => void;
}) {
  const [v, setV] = useState<Pick<PlatformDojo, 'name' | 'short_name' | 'plan' | 'status' | 'trial_ends_at'> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (dojo) {
      setV({ name: dojo.name, short_name: dojo.short_name, plan: dojo.plan, status: dojo.status,
        trial_ends_at: dojo.trial_ends_at ? String(dojo.trial_ends_at).slice(0, 10) : null });
      setErr(null);
    }
  }, [dojo]);
  if (!dojo || !v) return null;

  async function save() {
    if (!v!.name.trim()) { setErr(pt('required')); return; }
    setBusy(true); setErr(null);
    try {
      onSaved(await platformApi.updateDojo(dojo!.id, {
        name: v!.name.trim(), short_name: v!.short_name?.trim() || null, plan: v!.plan, status: v!.status,
        trial_ends_at: v!.status === 'trial' || v!.status === 'expired' ? v!.trial_ends_at : null,
      }));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog visible title={pt('editDojo')} onClose={onClose}
      actions={<>
        <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
        <Button label={pt('save')} variant="dark" icon="check" loading={busy} onPress={save} />
      </>}>
      <Text variant="small" color={palette.ink2}>{`${dojo.slug}.${DOMAIN}`}</Text>
      <Field label={`${pt('f_name')} *`} value={v.name} onChangeText={(x) => setV({ ...v, name: x })} />
      <Field label={pt('f_shortName')} value={v.short_name ?? ''} onChangeText={(x) => setV({ ...v, short_name: x })} maxLength={50} />
      <Select label={pt('f_plan')} value={v.plan} onChange={(x) => x && setV({ ...v, plan: x })} options={PLANS.map((p) => ({ value: p, label: pt(`plan_${p}`) }))} />
      <Select label={pt('f_status')} value={v.status} onChange={(x) => x && setV({ ...v, status: x })}
        options={(['trial', 'active', 'expired', 'suspended', 'cancelled'] as const).map((s) => ({ value: s, label: pt(`status_${s}`) }))} />
      {v.status === 'trial' || v.status === 'expired' ? (
        <DateField label={pt('f_trialEnds')} value={v.trial_ends_at} onChange={(x) => setV({ ...v, trial_ends_at: x })} />
      ) : null}
      {v.status === 'expired' ? <Text variant="small" color={palette.ink2}>{pt('expiredHint')}</Text> : null}
      {v.status === 'suspended' && dojo.status !== 'suspended' ? <Notice tone="warning">{pt('suspendWarn')}</Notice> : null}
      {v.status === 'cancelled' && dojo.status !== 'cancelled' ? <Notice tone="warning">{pt('cancelWarn')}</Notice> : null}
      {err ? <Notice tone="danger">{err}</Notice> : null}
      <DeleteDojoSection dojo={dojo} onDeleted={onDeleted} />
    </Dialog>
  );
}

function DojosTab() {
  const wide = useIsWide();
  const router = useRouter();
  const { dojo: currentDojo, switchDojo } = useSession();
  const data = useApi(() => platformApi.dojos(), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlatformDojo | null>(null);
  const [entering, setEntering] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <Notice tone="danger">{data.error ?? ''}</Notice>;
  const list = data.data;

  async function enter(id: number) {
    setEntering(id); setMsg(null);
    try { await switchDojo(id); router.replace('/home'); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setEntering(null); }
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: space.sm }}>
        <Text variant="bodyStrong" style={{ flex: wide ? 1 : undefined }}>{pt('dojosCount', { count: list.length })}</Text>
        <Button label={pt('newDojo')} icon="plus" onPress={() => { setMsg(null); setCreating(true); }} fullWidth={!wide} />
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {list.length === 0 ? <EmptyState icon="home" title={pt('noDojos')} /> : null}
      <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: wide ? 'wrap' : 'nowrap', gap: space.md }}>
        {list.map((d) => (
          <View key={d.id} style={{ width: wide ? '48.5%' : '100%' }}>
            <DojoCard d={d} current={d.id === currentDojo?.id} entering={entering === d.id}
              onEnter={() => enter(d.id)} onEdit={() => setEditing(d)} />
          </View>
        ))}
      </View>
      <NewDojoDialog visible={creating} onClose={() => setCreating(false)} dojos={list}
        defaultCopy={currentDojo && list.some((d) => d.id === currentDojo.id) ? currentDojo.id : null}
        onCreated={(text) => { setCreating(false); setMsg({ tone: 'success', text }); data.reload(); }} />
      <EditDojoDialog dojo={editing} onClose={() => setEditing(null)}
        onSaved={(d) => { setEditing(null); setMsg({ tone: 'success', text: pt('saved') }); data.setData(list.map((x) => (x.id === d.id ? d : x))); }}
        onDeleted={(text) => { const id = editing?.id; setEditing(null); setMsg({ tone: 'success', text }); data.setData(list.filter((x) => x.id !== id)); }} />
    </View>
  );
}


// ===========================================================================
// Solicitudes de registro
// ===========================================================================
function SignupSettingsCard({ s, onSaved }: { s: SignupSettings; onSaved: (s: SignupSettings) => void }) {
  const wide = useIsWide();
  const [enabled, setEnabled] = useState(s.signup_enabled);
  const [days, setDays] = useState(String(s.trial_days));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { setEnabled(s.signup_enabled); setDays(String(s.trial_days)); }, [s]);
  const dirty = enabled !== s.signup_enabled || Number(days) !== s.trial_days;
  const formUrl = RNPlatform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}/signup` : '/signup';

  async function save() {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) { setMsg({ tone: 'danger', text: pt('required') }); return; }
    setBusy(true); setMsg(null);
    try { onSaved(await signupApi.saveSettings({ signup_enabled: enabled, trial_days: n })); setMsg({ tone: 'success', text: pt('saved') }); }
    catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyStrong">{pt('sg_settings')}</Text>
      <SwitchRow label={pt('sg_enabled')} hint={pt('sg_enabledHint', { url: formUrl })} value={enabled} onChange={setEnabled} />
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.md, alignItems: wide ? 'flex-end' : 'stretch' }}>
        <View style={{ width: wide ? 220 : '100%' }}>
          <Field label={pt('sg_trialDays')} value={days} keyboardType="number-pad" onChangeText={(x) => setDays(x.replace(/\D/g, '').slice(0, 3))} />
        </View>
        <Button label={pt('save')} variant="dark" icon="check" loading={busy} disabled={!dirty} onPress={save} fullWidth={!wide} />
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}

const SG_TONE: Record<SignupStatus, Tone> = { pending: 'info', approved: 'success', rejected: 'neutral' };

function SignupCard({ s, onApprove, onReject }: { s: Signup; onApprove: () => void; onReject: () => void }) {
  const wide = useIsWide();
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ');
  const where = [s.city, s.country_code !== 'XX' ? s.country_code : null].filter(Boolean).join(', ');
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong">{s.dojo_name}</Text>
          <Text variant="small" color={palette.ink2}>{dojoHost(s.dojo_slug || s.slug)}</Text>
        </View>
        <Badge label={pt(`sg_status_${s.status}`)} tone={SG_TONE[s.status]} />
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="small">{`${name} · ${s.email}${s.phone ? ` · ${s.phone}` : ''}`}</Text>
        <Text variant="small" color={palette.ink2}>
          {[where, s.timezone.replace(/_/g, ' '), s.disciplines, s.students_estimate != null ? pt('sg_students', { count: s.students_estimate }) : null]
            .filter(Boolean).join(' · ')}
        </Text>
        <Text variant="small" color={palette.ink2}>{pt('sg_received', { when: dateTimeShort(s.created_at) })}</Text>
        {s.reviewed_at ? (
          <Text variant="small" color={palette.ink2}>
            {pt('sg_reviewed', { status: pt(`sg_status_${s.status}`), when: dateTimeShort(s.reviewed_at), by: s.reviewed_by_name || '—' })}
            {s.review_note ? ` · ${s.review_note}` : ''}
          </Text>
        ) : null}
      </View>
      {s.message ? (
        <View style={{ backgroundColor: palette.sunken, borderRadius: radius.md, padding: space.sm }}>
          <Text variant="small">{s.message}</Text>
        </View>
      ) : null}
      {s.status === 'pending' && s.email_has_account ? <Text variant="small" color={palette.ink2}>{pt('sg_hasAccount')}</Text> : null}
      {s.status === 'pending' && s.slug_status && !s.slug_status.available ? (
        <Notice tone="warning">{pt('sg_slugUnavailable', { slug: s.slug })}</Notice>
      ) : null}
      {s.status === 'pending' ? (
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs, justifyContent: 'flex-end' }}>
          <Button label={pt('sg_reject')} variant="secondary" size="sm" icon="x" onPress={onReject} fullWidth={!wide} />
          <Button label={pt('sg_approve')} variant="dark" size="sm" icon="check" onPress={onApprove} fullWidth={!wide} />
        </View>
      ) : null}
    </Card>
  );
}

function ApproveDialog({ s, trialDays, dojos, onClose, onDone }: {
  s: Signup | null; trialDays: number; dojos: PlatformDojo[]; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [days, setDays] = useState('');
  const [copyFrom, setCopyFrom] = useState<number>(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (s) { setName(s.dojo_name); setSlug(s.slug); setDays(String(trialDays)); setCopyFrom(0); setNote(''); setErr(null); }
  }, [s, trialDays]);
  if (!s) return null;

  async function approve() {
    const n = Number(days);
    if (!name.trim() || !slug || !Number.isInteger(n) || n < 1) { setErr(pt('required')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await signupApi.approve(s!.id, {
        name: name.trim(), slug, trial_days: n, copy_from_dojo_id: copyFrom || null, note: note.trim() || undefined,
      });
      const ends = r.dojo.trial_ends_at ? dayLong(String(r.dojo.trial_ends_at).slice(0, 10)) : '';
      onDone([pt('sg_approved', { name: r.dojo.name, date: ends }),
        r.email_sent ? pt('sg_approvedMail', { email: r.owner.email }) : pt('sg_approvedNoMail', { email: r.owner.email })].join(' '));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog visible title={pt('sg_approveTitle', { name: s.dojo_name })} onClose={onClose}
      actions={<>
        <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
        <Button label={pt('sg_approve')} variant="dark" icon="check" loading={busy} onPress={approve} />
      </>}>
      <Text variant="small" color={palette.ink2}>{pt('sg_approveBody', { email: s.email })}</Text>
      <Field label={`${pt('f_name')} *`} value={name} onChangeText={setName} />
      <Field label={`${pt('f_slug')} *`} value={slug} autoCapitalize="none" autoCorrect={false}
        onChangeText={(x) => setSlug(slugify(x))} hint={slug ? pt('f_slugHint', { url: dojoHost(slug) }) : undefined} />
      <Field label={pt('sg_trialDays')} value={days} keyboardType="number-pad" onChangeText={(x) => setDays(x.replace(/\D/g, '').slice(0, 3))} />
      <Select label={pt('f_copyFrom')} value={copyFrom} onChange={(x) => setCopyFrom(Number(x) || 0)}
        options={[{ value: 0, label: pt('copyNone') }, ...dojos.map((d) => ({ value: d.id, label: d.name }))]} />
      <Text variant="small" color={palette.ink2}>{pt('f_copyFromHint')}</Text>
      <Field label={pt('sg_note')} value={note} onChangeText={setNote} maxLength={500} />
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

function RejectDialog({ s, onClose, onDone }: { s: Signup | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (s) { setReason(''); setNotify(true); setErr(null); } }, [s]);
  if (!s) return null;

  async function reject() {
    setBusy(true); setErr(null);
    try { await signupApi.reject(s!.id, { reason: reason.trim() || undefined, notify }); onDone(pt('sg_rejected')); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Dialog visible title={pt('sg_rejectTitle', { name: s.dojo_name })} onClose={onClose}
      actions={<>
        <Button label={t('common.cancel')} variant="ghost" onPress={onClose} />
        <Button label={pt('sg_reject')} variant="dark" icon="x" loading={busy} onPress={reject} />
      </>}>
      <Field label={pt('sg_reason')} value={reason} onChangeText={setReason} maxLength={500} hint={pt('sg_reasonHint')} />
      <SwitchRow label={pt('sg_notify')} value={notify} onChange={setNotify} />
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Dialog>
  );
}

function SignupsTab({ onPendingChange }: { onPendingChange: (n: number) => void }) {
  const [filter, setFilter] = useState<SignupStatus | 'all'>('pending');
  const data = useApi(() => signupApi.list(filter), [filter]);
  const dojos = useApi(() => platformApi.dojos(), []);
  const [approving, setApproving] = useState<Signup | null>(null);
  const [rejecting, setRejecting] = useState<Signup | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const d = data.data;
  useEffect(() => { if (d) onPendingChange(d.pending); }, [d?.pending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data.loading && !d) return <Loading />;
  if (data.error && !d) return <Notice tone="danger">{data.error}</Notice>;
  if (!d) return null;
  const done = (text: string) => { setApproving(null); setRejecting(null); setMsg({ tone: 'success', text }); data.reload(); dojos.reload(); };

  return (
    <View style={{ gap: space.md }}>
      <SignupSettingsCard s={d.settings} onSaved={(settings) => data.setData({ ...d, settings })} />
      <FilterChips label={pt('tab_signups')} value={filter} onChange={(k) => { setMsg(null); setFilter(k); }}
        options={(['pending', 'approved', 'rejected', 'all'] as const).map((k) => ({ key: k, label: pt(`sg_filter_${k}`) }))} />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      {d.signups.length === 0 ? (
        <EmptyState icon="inbox" title={pt('sg_empty')} body={filter === 'pending' ? pt('sg_emptyPending') : undefined} />
      ) : null}
      {d.signups.map((s) => (
        <SignupCard key={s.id} s={s} onApprove={() => { setMsg(null); setApproving(s); }} onReject={() => { setMsg(null); setRejecting(s); }} />
      ))}
      <ApproveDialog s={approving} trialDays={d.settings.trial_days} dojos={dojos.data ?? []} onClose={() => setApproving(null)} onDone={done} />
      <RejectDialog s={rejecting} onClose={() => setRejecting(null)} onDone={done} />
    </View>
  );
}

// ===========================================================================
// Respaldos
// ===========================================================================
function ScheduleCard({ s, onSaved, onRun, running }: { s: BackupSettings; onSaved: (s: BackupSettings) => void; onRun: () => Promise<void>; running: boolean }) {
  const wide = useIsWide();
  const [v, setV] = useState(s);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => setV(s), [s]);
  const dirty = v.backup_enabled !== s.backup_enabled || v.backup_frequency !== s.backup_frequency || v.backup_hour !== s.backup_hour
    || v.backup_weekday !== s.backup_weekday || v.backup_keep !== s.backup_keep || v.timezone !== s.timezone;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      onSaved(await platformApi.saveSettings({
        backup_enabled: v.backup_enabled, backup_frequency: v.backup_frequency, backup_hour: v.backup_hour,
        backup_weekday: v.backup_weekday, backup_keep: v.backup_keep, timezone: v.timezone,
      }));
      setMsg({ tone: 'success', text: pt('saved') });
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  async function run() {
    setMsg(null);
    try { await onRun(); setMsg({ tone: 'success', text: pt('runStarted') }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); }
  }

  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyStrong">{pt('b_title')}</Text>
      <Text variant="small" color={palette.ink2}>{pt('b_intro')}</Text>
      <SwitchRow label={pt('b_enabled')} value={v.backup_enabled} onChange={(x) => setV({ ...v, backup_enabled: x })} />
      <FormGrid>
        <Select label={pt('b_frequency')} value={v.backup_frequency} onChange={(x) => x && setV({ ...v, backup_frequency: x })}
          options={[{ value: 'daily', label: pt('freq_daily') }, { value: 'weekly', label: pt('freq_weekly') }]} />
        {v.backup_frequency === 'weekly' ? (
          <Select label={pt('b_weekday')} value={v.backup_weekday} onChange={(x) => x !== null && setV({ ...v, backup_weekday: x })}
            options={[0, 1, 2, 3, 4, 5, 6].map((i) => ({ value: i, label: weekdayName(i) }))} />
        ) : null}
        <Select label={pt('b_hour')} value={v.backup_hour} onChange={(x) => x !== null && setV({ ...v, backup_hour: x })}
          options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))} />
        <Select label={pt('b_keep')} value={v.backup_keep} onChange={(x) => x && setV({ ...v, backup_keep: x })}
          options={Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} />
        <Select label={pt('b_timezone')} value={v.timezone} onChange={(x) => x && setV({ ...v, timezone: x })} options={tzOptions(v.timezone)} />
      </FormGrid>
      <Text variant="small" color={palette.ink2}>{pt('b_keepHint')}</Text>
      <Text variant="smallStrong">{s.backup_enabled && s.next_run ? pt('b_next', { when: localWhen(s.next_run) }) : pt('b_off')}</Text>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs, justifyContent: 'flex-end' }}>
        <Button label={running ? pt('running') : pt('runNow')} variant="secondary" icon="download-cloud" loading={running}
          disabled={running} onPress={run} fullWidth={!wide} />
        <Button label={pt('save')} variant="dark" icon="check" loading={busy} disabled={!dirty} onPress={save} fullWidth={!wide} />
      </View>
    </Card>
  );
}

type Provider = 'aws' | 'b2' | 'r2' | 'wasabi' | 'other';
function providerOf(endpoint: string | null | undefined): Provider {
  const e = endpoint || '';
  if (!e) return 'aws';
  if (e.includes('backblazeb2.com')) return 'b2';
  if (e.includes('r2.cloudflarestorage.com')) return 'r2';
  if (e.includes('wasabisys.com')) return 'wasabi';
  return 'other';
}
const PROVIDER_DEFAULTS: Record<Provider, { endpoint: string; region: string; path: boolean }> = {
  aws: { endpoint: '', region: 'us-east-1', path: false },
  b2: { endpoint: 'https://s3.us-west-004.backblazeb2.com', region: 'us-west-004', path: false },
  r2: { endpoint: 'https://ID_DE_CUENTA.r2.cloudflarestorage.com', region: 'auto', path: false },
  wasabi: { endpoint: 'https://s3.us-east-1.wasabisys.com', region: 'us-east-1', path: false },
  other: { endpoint: 'https://', region: 'us-east-1', path: true },
};

function S3Card({ s, onSaved }: { s: BackupSettings; onSaved: (s: BackupSettings) => void }) {
  const wide = useIsWide();
  const [v, setV] = useState(s);
  const [secret, setSecret] = useState('');
  const [provider, setProvider] = useState<Provider>(providerOf(s.s3_endpoint));
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { setV(s); setProvider(providerOf(s.s3_endpoint)); }, [s]);
  const disabled = !s.encryption_available;

  const body = (): SettingsPatch => ({
    s3_enabled: v.s3_enabled, s3_endpoint: v.s3_endpoint?.trim() || '', s3_region: v.s3_region?.trim() || null,
    s3_bucket: v.s3_bucket?.trim() || null, s3_prefix: v.s3_prefix?.trim() || null, s3_access_key: v.s3_access_key?.trim() || null,
    s3_force_path_style: v.s3_force_path_style, s3_keep: v.s3_keep, ...(secret ? { s3_secret: secret } : {}),
  });
  async function save() {
    setBusy('save'); setMsg(null);
    try { onSaved(await platformApi.saveSettings(body())); setSecret(''); setMsg({ tone: 'success', text: pt('saved') }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(null); }
  }
  async function test() {
    setBusy('test'); setMsg(null);
    try { await platformApi.testS3(body()); setMsg({ tone: 'success', text: pt('s3_testOk') }); } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(null); }
  }
  function pickProvider(p: Provider) {
    setProvider(p);
    const d = PROVIDER_DEFAULTS[p];
    setV({ ...v, s3_endpoint: d.endpoint, s3_region: d.region, s3_force_path_style: d.path });
  }

  return (
    <Card style={{ gap: space.md }}>
      <Text variant="bodyStrong">{pt('s3_title')}</Text>
      <Text variant="small" color={palette.ink2}>{pt('s3_intro')}</Text>
      {disabled ? <Notice tone="warning">{pt('s3_noKey')}</Notice> : <Notice tone="info">{pt('s3_encrypted')}</Notice>}
      <SwitchRow label={pt('s3_enabled')} value={v.s3_enabled} disabled={disabled} onChange={(x) => setV({ ...v, s3_enabled: x })} />
      <FormGrid>
        <Select label={pt('s3_provider')} value={provider} disabled={disabled} onChange={(x) => x && pickProvider(x)}
          options={(['aws', 'b2', 'r2', 'wasabi', 'other'] as const).map((p) => ({ value: p, label: pt(`prov_${p}`) }))} />
        {provider !== 'aws' ? (
          <Field label={pt('s3_endpoint')} value={v.s3_endpoint ?? ''} editable={!disabled} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" hint={pt('s3_endpointHint')} onChangeText={(x) => setV({ ...v, s3_endpoint: x })} />
        ) : null}
        <Field label={pt('s3_region')} value={v.s3_region ?? ''} editable={!disabled} autoCapitalize="none" onChangeText={(x) => setV({ ...v, s3_region: x })} />
        <Field label={pt('s3_bucket')} value={v.s3_bucket ?? ''} editable={!disabled} autoCapitalize="none" autoCorrect={false} onChangeText={(x) => setV({ ...v, s3_bucket: x })} />
        <Field label={pt('s3_prefix')} value={v.s3_prefix ?? ''} editable={!disabled} autoCapitalize="none" hint={pt('s3_prefixHint')} onChangeText={(x) => setV({ ...v, s3_prefix: x })} />
        <Field label={pt('s3_accessKey')} value={v.s3_access_key ?? ''} editable={!disabled} autoCapitalize="none" autoCorrect={false} onChangeText={(x) => setV({ ...v, s3_access_key: x })} />
        <Field label={pt('s3_secret')} value={secret} editable={!disabled} secureTextEntry secureToggle autoCapitalize="none" autoCorrect={false}
          placeholder={s.s3_has_secret ? '••••••••' : ''} hint={s.s3_has_secret ? pt('s3_secretSaved') : undefined} onChangeText={setSecret} />
        <Field label={pt('s3_keep')} value={String(v.s3_keep ?? '')} editable={!disabled} keyboardType="number-pad" hint={pt('s3_keepHint')}
          onChangeText={(x) => setV({ ...v, s3_keep: Number(x.replace(/\D/g, '')) || 0 })} />
      </FormGrid>
      {provider === 'other' ? (
        <SwitchRow label={pt('s3_pathStyle')} value={v.s3_force_path_style} disabled={disabled} onChange={(x) => setV({ ...v, s3_force_path_style: x })} />
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs, justifyContent: 'flex-end' }}>
        <Button label={pt('s3_test')} variant="secondary" icon="zap" loading={busy === 'test'} disabled={disabled} onPress={test} fullWidth={!wide} />
        <Button label={pt('save')} variant="dark" icon="check" loading={busy === 'save'} disabled={disabled} onPress={save} fullWidth={!wide} />
      </View>
    </Card>
  );
}

const BACKUP_TONE: Record<Backup['status'], Tone> = { running: 'info', ok: 'success', failed: 'danger' };

function BackupRow({ b, onRestore, onError }: { b: Backup; onRestore: () => void; onError: (m: string) => void }) {
  const wide = useIsWide();
  const [busy, setBusy] = useState<'local' | 's3' | null>(null);
  async function dl(source: 'local' | 's3') {
    setBusy(source);
    try { await downloadBackup(b.id, source); } catch (e) { onError(errorMessage(e)); } finally { setBusy(null); }
  }
  const icon = b.status === 'ok' ? 'check-circle' : b.status === 'failed' ? 'x-circle' : 'loader';
  const color = b.status === 'ok' ? palette.success : b.status === 'failed' ? palette.danger : palette.ink2;
  const s3Line = b.s3_status === 'ok' ? pt('inS3') : b.s3_status === 'uploading' ? pt('s3_uploading')
    : b.s3_status === 'failed' ? pt('s3_failed') : b.s3_status === 'deleted' ? pt('s3_deleted') : null;

  return (
    <View style={{ gap: space.xs, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: palette.lineSoft }}>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Icon name={icon} size={20} color={color} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="smallStrong" numberOfLines={1}>{b.filename}</Text>
          <Text variant="small" color={palette.ink2}>
            {[dateTimeShort(b.started_at), b.trigger === 'auto' ? pt('tr_auto') : b.created_by_name ? pt('tr_manual', { name: b.created_by_name }) : pt('tr_manualAnon')].join(' · ')}
          </Text>
          {b.status === 'ok' ? (
            <Text variant="small" color={palette.ink2}>
              {[fileSize(b.size_bytes), pt('rows', { count: b.rows_count ?? 0 }), pt('files', { count: b.files_count ?? 0 })].join(' · ')}
            </Text>
          ) : null}
        </View>
        <Badge label={pt(`st_${b.status}`)} tone={BACKUP_TONE[b.status]} />
      </View>
      {b.status === 'failed' && b.error ? <Text variant="small" color={palette.danger} style={{ paddingLeft: 28 }}>{b.error}</Text> : null}
      {b.status === 'ok' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingLeft: 28 }}>
          <Badge label={b.local_available ? pt('inServer') : pt('inServerGone')} tone={b.local_available ? 'success' : 'neutral'} />
          {s3Line ? <Badge label={s3Line} tone={b.s3_status === 'ok' ? 'success' : b.s3_status === 'failed' ? 'danger' : 'neutral'} /> : null}
        </View>
      ) : null}
      {b.s3_status === 'failed' && b.s3_error ? <Text variant="small" color={palette.danger} style={{ paddingLeft: 28 }}>{b.s3_error}</Text> : null}
      {b.local_available || b.s3_available ? (
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xs, paddingLeft: wide ? 28 : 0, justifyContent: 'flex-end' }}>
          <Button label={pt('restore')} variant="ghost" size="sm" icon="rotate-ccw" onPress={onRestore} fullWidth={!wide} />
          {b.s3_available ? <Button label={pt('downloadS3')} variant="secondary" size="sm" icon="cloud" loading={busy === 's3'} onPress={() => dl('s3')} fullWidth={!wide} /> : null}
          {b.local_available ? <Button label={pt('download')} variant="dark" size="sm" icon="download" loading={busy === 'local'} onPress={() => dl('local')} fullWidth={!wide} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function RestoreDialog({ b, onClose }: { b: Backup | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [b]);
  if (!b) return null;
  const file = b.local_available ? b.filename : `${b.filename}.enc`;
  const cmd = `./deploy.sh restore ${file}`;
  return (
    <Dialog visible title={pt('restoreTitle')} onClose={onClose}
      actions={<Button label={t('common.close')} variant="dark" onPress={onClose} />}>
      <Notice tone="warning">{pt('restoreBody')}</Notice>
      <Text variant="small">{pt('restoreStep1')}</Text>
      <Text variant="small">{pt('restoreStep2')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={pt('copy')}
        onPress={async () => { if (await copyText(cmd)) setCopied(true); }}
        style={{ backgroundColor: palette.ink, borderRadius: radius.md, padding: space.md, gap: space.xs }}>
        <Text variant="small" color="#FFFFFF" selectable style={{ fontFamily: RNPlatform.select({ web: 'monospace', ios: 'Menlo', default: 'monospace' }) }}>{cmd}</Text>
        {RNPlatform.OS === 'web' ? <Text variant="caption" color={palette.mutedOnDark}>{copied ? pt('copied') : pt('copy')}</Text> : null}
      </Pressable>
      <Text variant="small">{pt('restoreStep3')}</Text>
      {b.s3_available ? <Text variant="small" color={palette.ink2}>{pt('restoreEnc')}</Text> : null}
    </Dialog>
  );
}

function BackupsTab() {
  const data = useApi(() => platformApi.backups(), []);
  const [restore, setRestore] = useState<Backup | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = data.data;
  const active = !!d && (d.running || d.backups.some((b) => b.status === 'running' || b.s3_status === 'uploading'));

  // Mientras hay un respaldo en curso, se actualiza solo
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => data.reload(), 2500);
    return () => clearInterval(id);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data.loading && !d) return <Loading />;
  if (data.error && !d) return <Notice tone="danger">{data.error}</Notice>;
  if (!d) return null;

  const setSettings = (s: BackupSettings) => data.setData({ ...d, settings: s });
  async function run() {
    const b = await platformApi.runNow();
    data.setData({ ...d!, running: true, backups: [b, ...d!.backups] });
  }

  return (
    <View style={{ gap: space.lg }}>
      <ScheduleCard s={d.settings} onSaved={(s) => { setSettings(s); data.reload(); }} onRun={run} running={active} />
      <S3Card s={d.settings} onSaved={setSettings} />
      <Card style={{ gap: 0 }}>
        <Text variant="bodyStrong" style={{ paddingBottom: space.sm }}>{pt('list_title')}</Text>
        {err ? <Notice tone="danger">{err}</Notice> : null}
        {d.backups.length === 0 ? <EmptyState icon="archive" title={pt('list_empty')} body={pt('list_emptyBody')} /> : null}
        {d.backups.map((b) => <BackupRow key={b.id} b={b} onRestore={() => setRestore(b)} onError={setErr} />)}
      </Card>
      <RestoreDialog b={restore} onClose={() => setRestore(null)} />
    </View>
  );
}

// ===========================================================================
export function PlatformScreen() {
  useLanguage();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initial: TabKey = params.tab === 'backups' || params.tab === 'signups' ? params.tab : 'dojos';
  const [tab, setTab] = useState<TabKey>(initial);
  const [pending, setPending] = useState(0);
  useEffect(() => { signupApi.list('pending').then((r) => setPending(r.pending)).catch(() => {}); }, []);
  const tabs = useMemo(() => (['dojos', 'signups', 'backups'] as const).map((k) => ({
    key: k, label: pt(`tab_${k}`), badge: k === 'signups' && pending ? pending : undefined,
  })), [pending]);
  return (
    <Screen maxWidth={1000}>
      <View style={{ gap: 4 }}>
        <Text variant="title" accessibilityRole="header">{pt('title')}</Text>
        <Text variant="small" color={palette.ink2}>{pt('subtitle')}</Text>
      </View>
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      <View key={tab}>
        {tab === 'dojos' ? <DojosTab /> : tab === 'signups' ? <SignupsTab onPendingChange={setPending} /> : <BackupsTab />}
      </View>
    </Screen>
  );
}
