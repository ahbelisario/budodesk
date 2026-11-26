/**
 * Perfil: Mis datos (con foto) · Mis hijos · Cuenta
 * (idioma, notificaciones, contraseña, sesiones, dojos)
 */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSession } from '../session/SessionProvider';
import { api, ApiError } from '../api/client';
import { meApi, profileDiff, type MyProfile } from '../api/members';
import { useApi } from '../utils/useApi';
import { errorMessage } from '../utils/errors';
import { Screen } from '../ui/Screen';
import { Avatar, Badge, Button, Card, Divider, Field, Icon, Loading, Notice, SectionHeader, Text } from '../ui/primitives';
import { Dialog } from '../ui/Dialog';
import { SwitchRow, Tabs } from '../ui/forms';
import { palette, space } from '../theme/tokens';
import { getLanguage, setLanguage, t, useLanguage, type Lang } from '../i18n';
import { dateTimeShort, fullName } from '../utils/format';
import { PersonForm, PhotoPicker, type PersonValue } from './members/PersonForm';
import { mt } from './members/bits';
import { DevicePushCard } from '../push/DevicePushCard';
import { AppVersion } from '../ui/AppVersion';

type TabKey = 'data' | 'children' | 'account';
type Msg = { tone: 'success' | 'danger'; text: string } | null;

// ---------------------------------------------------------------------------
function ProfileEditor({ load, save, userId, onPhoto, hint }: {
  load: () => Promise<MyProfile>; save: (b: Record<string, unknown>) => Promise<MyProfile>; userId?: number; onPhoto?: (url: string) => void; hint?: string;
}) {
  const data = useApi(load, [userId]);
  const [v, setV] = useState<PersonValue>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (data.data) setV(data.data); }, [data.data]);

  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <Notice tone="danger">{data.error ?? ''}</Notice>;
  const p = data.data;

  async function submit() {
    setMsg(null); setErrors({});
    if (!v.first_name?.trim()) { setErrors({ first_name: mt('required') }); return; }
    const body = profileDiff(p, v);
    if (!Object.keys(body).length) { setMsg({ tone: 'success', text: mt('saved') }); return; }
    setSaving(true);
    try { data.setData(await save(body)); setMsg({ tone: 'success', text: mt('saved') }); }
    catch (e) {
      if (e instanceof ApiError) setErrors(Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message])));
      setMsg({ tone: 'danger', text: errorMessage(e) });
    } finally { setSaving(false); }
  }

  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.lg }}>
        <PhotoPicker name={fullName({ first_name: p.first_name, last_name: p.last_name })} photoUrl={p.photo_url} userId={userId}
          onUploaded={(url) => { data.setData({ ...p, photo_url: url }); onPhoto?.(url); setMsg({ tone: 'success', text: mt('photoUpdated') }); }} />
        {hint ? <Text variant="small" color={palette.ink2}>{hint}</Text> : null}
        <PersonForm value={v} onChange={setV} errors={errors} sections={['person', 'contact', 'emergency', 'address']} />
      </Card>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Button label={t('common.save')} variant="dark" icon="check" loading={saving} onPress={submit} style={{ alignSelf: 'flex-end' }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
function ChildrenTab() {
  const { minors } = useSession();
  const [open, setOpen] = useState<number | null>(minors.length === 1 ? minors[0].user_id : null);
  return (
    <View style={{ gap: space.md }}>
      <Text variant="small" color={palette.ink2}>{mt('myChildrenHint')}</Text>
      {minors.map((c) => {
        const name = fullName(c);
        const on = open === c.user_id;
        return (
          <View key={c.user_id} style={{ gap: space.md }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => setOpen(on ? null : c.user_id)}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} padding={space.md}>
                <Avatar name={name} photoUrl={c.photo_url} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{name}</Text>
                  <Text variant="caption" color={palette.ink2}>{mt(`rel_${c.relationship}`)}</Text>
                </View>
                <Icon name={on ? 'chevron-up' : 'chevron-down'} size={20} color={palette.ink2} />
              </Card>
            </Pressable>
            {on ? (
              <ProfileEditor userId={c.user_id} load={() => meApi.minorProfile(c.user_id)} save={(b) => meApi.updateMinor(c.user_id, b)} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
function AccountTab() {
  const { user, dojo, dojos, logout, reload } = useSession();
  const router = useRouter();
  const prof = useApi(() => meApi.profile(), []);
  const sessions = useApi(() => meApi.sessions(), []);
  const [lang, setLang] = useState<Lang>(getLanguage());
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<Msg>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMsg, setJoinMsg] = useState<Msg>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [notif, setNotif] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!prof.data) return;
    const p = prof.data;
    setNotif({
      notify_email: p.notify_email !== 0, notify_push: p.notify_push !== 0, notify_class_reminders: p.notify_class_reminders !== 0,
      notify_payment_reminders: p.notify_payment_reminders !== 0, notify_announcements: p.notify_announcements !== 0,
    });
  }, [prof.data]);

  async function changeLang(l: Lang) {
    setLang(l);
    await setLanguage(l);
    api.patch('/me/settings', { language: l }).catch(() => {});
  }
  async function toggle(key: string, val: boolean) {
    setNotif((n) => ({ ...n, [key]: val }));
    try { await meApi.settings({ [key]: val }); } catch { setNotif((n) => ({ ...n, [key]: !val })); }
  }
  async function changePassword() {
    setPwMsg(null); setPwErr(null);
    if (next.length < 10) { setPwErr(t('auth.passwordHint')); return; }
    setPwBusy(true);
    try {
      await api.post('/me/password', { current_password: current, new_password: next });
      setCurrent(''); setNext('');
      setPwMsg({ tone: 'success', text: getLanguage() === 'en' ? 'Password updated. Other devices were signed out.' : 'Contraseña actualizada. Se cerró la sesión en tus otros dispositivos.' });
      sessions.reload();
    } catch (e) {
      setPwMsg({ tone: 'danger', text: e instanceof ApiError && e.code === 'WRONG_PASSWORD' ? (getLanguage() === 'en' ? 'Current password is incorrect.' : 'La contraseña actual no es correcta.') : errorMessage(e) });
    } finally { setPwBusy(false); }
  }
  async function join() {
    setJoinMsg(null);
    const s = slug.trim().toLowerCase();
    if (!s) return;
    setJoinBusy(true);
    try {
      const r = await meApi.joinDojo(s);
      setJoinMsg({ tone: 'success', text: r.membership_status === 'active' ? mt('joinedNow', { dojo: s }) : mt('joinRequested', { dojo: s }) });
      setSlug('');
      reload().catch(() => {});
    } catch (e) { setJoinMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setJoinBusy(false); }
  }
  async function logoutAll() {
    setConfirmAll(false);
    try { await meApi.logoutAll(); } catch { /* igual se cierra aquí */ }
    await logout();
  }

  const N: [string, string][] = [
    ['notify_email', mt('n_email')], ['notify_push', mt('n_push')], ['notify_class_reminders', mt('n_classes')],
    ['notify_payment_reminders', mt('n_payments')], ['notify_announcements', mt('n_announcements')],
  ];

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <SectionHeader title={t('common.language')} />
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Button label="Español" size="sm" variant={lang === 'es' ? 'dark' : 'secondary'} onPress={() => changeLang('es')} />
          <Button label="English" size="sm" variant={lang === 'en' ? 'dark' : 'secondary'} onPress={() => changeLang('en')} />
        </View>
      </Card>

      <Card>
        <SectionHeader title={mt('notifications')} />
        <DevicePushCard pushPrefOn={!!notif.notify_push} pushPrefLabel={mt('n_push')} />
        {prof.loading ? <Loading /> : N.map(([k, label], i) => (
          <View key={k}>{i > 0 ? <Divider /> : null}<SwitchRow label={label} value={!!notif[k]} onChange={(v) => toggle(k, v)} /></View>
        ))}
      </Card>

      <Card>
        <SectionHeader title={mt('changePassword')} />
        {pwMsg ? <Notice tone={pwMsg.tone}>{pwMsg.text}</Notice> : null}
        <Field label={getLanguage() === 'en' ? 'Current password' : 'Contraseña actual'} value={current} onChangeText={setCurrent} secureToggle autoComplete="current-password" />
        <Field label={t('auth.newPassword')} value={next} onChangeText={setNext} secureToggle autoComplete="new-password" hint={t('auth.passwordHint')} error={pwErr} />
        <Button label={t('common.save')} variant="dark" loading={pwBusy} disabled={!current || !next} onPress={changePassword} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Card>
        <SectionHeader title={mt('sessions')} />
        <Text variant="small" color={palette.ink2}>{mt('sessionsHint')}</Text>
        {sessions.loading ? <Loading /> : (sessions.data ?? []).map((s, i) => (
          <View key={s.id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
              <Icon name={/mobile|android|iphone|expo|okhttp|darwin/i.test(s.user_agent ?? '') ? 'smartphone' : 'monitor'} size={20} color={palette.ink2} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" numberOfLines={1}>{describeAgent(s.user_agent)}</Text>
                <Text variant="caption" color={palette.ink2}>{mt('lastUsed', { date: dateTimeShort(s.last_used_at ?? s.created_at) })}</Text>
              </View>
              {s.current ? <Badge label={mt('thisDevice')} tone="success" /> : null}
            </View>
          </View>
        ))}
        <Button label={mt('logoutAll')} variant="secondary" icon="log-out" onPress={() => setConfirmAll(true)} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Card>
        <SectionHeader title={mt('joinDojo')} />
        {dojos.length > 1 ? (
          <View style={{ gap: space.xs }}>
            <Text variant="small" color={palette.ink2}>{dojo?.name}</Text>
            <Button label={t('nav.switchDojo')} variant="secondary" icon="repeat" size="sm" onPress={() => router.push('/choose-dojo')} style={{ alignSelf: 'flex-start' }} />
            <Divider />
          </View>
        ) : null}
        <Text variant="small" color={palette.ink2}>{mt('joinDojoHint')}</Text>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <View style={{ flexGrow: 1, flexBasis: 220 }}><Field label={mt('dojoSlug')} value={slug} onChangeText={setSlug} autoCapitalize="none" autoCorrect={false} /></View>
          <Button label={mt('joinDojo')} variant="secondary" loading={joinBusy} disabled={!slug.trim()} onPress={join} />
        </View>
        {joinMsg ? <Notice tone={joinMsg.tone}>{joinMsg.text}</Notice> : null}
      </Card>

      <View style={{ gap: space.xs }}>
        <Text variant="caption" color={palette.ink2}>{user?.email}</Text>
        <Button label={t('auth.signOut')} variant="danger" icon="log-out" onPress={logout} style={{ alignSelf: 'flex-start' }} />
        <AppVersion />
      </View>

      <Dialog visible={confirmAll} onClose={() => setConfirmAll(false)} title={mt('logoutAllTitle')}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirmAll(false)} /><Button label={mt('logoutAll')} variant="danger" onPress={logoutAll} /></>}>
        <Text color={palette.ink2}>{mt('logoutAllBody')}</Text>
      </Dialog>
    </View>
  );
}

function describeAgent(ua: string | null) {
  if (!ua) return '—';
  const os = /iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android' : /mac os/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : null;
  const br = /edg\//i.test(ua) ? 'Edge' : /chrome\//i.test(ua) ? 'Chrome' : /firefox\//i.test(ua) ? 'Firefox' : /safari\//i.test(ua) ? 'Safari' : /expo|okhttp|cfnetwork|darwin/i.test(ua) ? 'App BudoDesk' : null;
  return [br, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}

// ---------------------------------------------------------------------------
export function Profile() {
  useLanguage();
  const { user, roles, minors, reload } = useSession();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabKey>(params.tab === 'account' ? 'account' : params.tab === 'children' ? 'children' : 'data');
  if (!user) return null;
  const tabs: { key: TabKey; label: string }[] = [{ key: 'data', label: mt('myData') }];
  if (minors.length) tabs.push({ key: 'children', label: mt('myChildren') });
  tabs.push({ key: 'account', label: mt('account') });

  return (
    <Screen maxWidth={820}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar name={fullName(user)} photoUrl={user.photo_url} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" accessibilityRole="header">{fullName(user)}</Text>
          <Text variant="small" color={palette.ink2}>{user.email}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {roles.filter((r) => r !== 'admin' || !roles.includes('owner')).map((r) => <Badge key={r} label={t(`roles.${r}`)} />)}
          </View>
        </View>
      </View>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'data' ? <ProfileEditor load={() => meApi.profile()} save={(b) => meApi.update(b)} hint={mt('myDataHint')} onPhoto={() => reload().catch(() => {})} /> : null}
      {tab === 'children' ? <ChildrenTab /> : null}
      {tab === 'account' ? <AccountTab /> : null}
    </Screen>
  );
}
