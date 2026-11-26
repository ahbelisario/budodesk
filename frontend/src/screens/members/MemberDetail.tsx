/**
 * Ficha del alumno: encabezado, alerta médica y pestañas
 * Resumen · Grados · Membresía y pagos · Asistencia · Datos · Tutores
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { membersApi, profileDiff, type MemberDetail as Member, type DisciplineDef } from '../../api/members';
import { ApiError } from '../../api/client';
import type { Role } from '../../api/types';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Avatar, Badge, Button, Card, Divider, EmptyState, Field, Icon, Loading, Notice, SectionHeader, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { DateField, FormGrid, Select, SwitchRow, Tabs } from '../../ui/forms';
import { palette, space, fonts } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dateTimeShort, dayShort, fullName, money, dayYear } from '../../utils/format';
import { PersonForm, PhotoPicker, type PersonValue } from './PersonForm';
import { PersonPicker, type PickedPerson } from './PersonPicker';
import { RankChip, StatusBadge, mt } from './bits';
import { RoleToggles } from './MemberNew';
import { RanksTab } from './RanksTab';
import { BillingTab, PaymentDialog } from './BillingTab';

type TabKey = 'summary' | 'ranks' | 'billing' | 'attendance' | 'data' | 'guardians';

// ---------------------------------------------------------------------------
function MedicalAlert({ m }: { m: Member }) {
  if (!m.medical_notes && !m.blood_type && !m.emergency_contact_name) return null;
  const hasMedical = !!m.medical_notes;
  return (
    <View accessibilityRole="summary" style={{ borderRadius: 12, padding: space.md, gap: 6, borderWidth: 1,
      backgroundColor: hasMedical ? palette.dangerBg : palette.surface, borderColor: hasMedical ? '#FBCFD6' : palette.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name={hasMedical ? 'alert-triangle' : 'heart'} size={16} color={hasMedical ? palette.danger : palette.ink2} />
        <Text variant="smallStrong" color={hasMedical ? palette.danger : palette.ink}>{mt('medicalAlert')}</Text>
        {m.blood_type ? <Badge label={mt('bloodTypeShort', { type: m.blood_type })} tone={hasMedical ? 'danger' : 'neutral'} /> : null}
      </View>
      {m.medical_notes ? <Text variant="body" color={palette.ink}>{m.medical_notes}</Text> : null}
      {m.emergency_contact_name ? (
        <Text variant="small" color={palette.ink2}>
          {mt('emergency')}: {[m.emergency_contact_name, m.emergency_contact_relation].filter(Boolean).join(' · ')}{m.emergency_contact_phone ? ` · ${m.emergency_contact_phone}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
function SummaryTab({ m, financial, go }: { m: Member; financial: boolean; go: (k: TabKey) => void }) {
  const wide = useIsWide();
  const att = useApi(() => membersApi.attendance(m.id), [m.id]);
  const link = (k: TabKey, label: string) => (
    <Pressable accessibilityRole="link" onPress={() => go(k)}><Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{label}</Text></Pressable>
  );
  const box = { flexGrow: 1, flexBasis: wide ? 280 : undefined, minWidth: 0 } as const;
  return (
    <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: wide ? 'wrap' : 'nowrap', gap: space.lg }}>
      <Card style={box}>
        <SectionHeader title={mt('currentRank')} action={link('ranks', mt('tab_ranks'))} />
        {m.ranks.length === 0 ? <Text color={palette.ink2}>{mt('noRanks')}</Text> : m.ranks.map((r) => (
          <View key={r.discipline_id} style={{ gap: 4 }}>
            <Text variant="overline" color={palette.ink2}>{r.discipline}</Text>
            <Text style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 28 }}>{r.rank}</Text>
            {r.display_style === 'belt' ? <RankChip r={{ ...r, rank: '' }} /> : null}
            <Text variant="caption" color={palette.ink2}>{mt('since')} {dayYear(r.since_date)}{r.next_exam_date ? ` · ${mt('nextExam')} ${dayShort(r.next_exam_date)}` : ''}</Text>
          </View>
        ))}
      </Card>
      {financial ? (
        <Card style={box}>
          <SectionHeader title={mt('membership')} action={link('billing', mt('tab_billing'))} />
          {m.active_membership ? (
            <>
              <Text variant="heading">{m.active_membership.plan}</Text>
              {m.active_membership.current_period_end ? <Text variant="small" color={palette.ink2}>{mt('validUntil', { date: dayShort(m.active_membership.current_period_end) })}</Text> : null}
            </>
          ) : <Text color={palette.ink2}>{mt('noMembershipBody')}</Text>}
          <Divider />
          <Text variant="small" color={palette.ink2}>{mt('balance')}</Text>
          <Text variant="heading" color={(m.balance_due ?? 0) > 0 ? palette.danger : palette.success}>
            {(m.balance_due ?? 0) > 0 ? money(m.balance_due) : mt('upToDate')}
          </Text>
        </Card>
      ) : null}
      <Card style={box}>
        <SectionHeader title={mt('tab_attendance')} action={link('attendance', mt('recentClasses'))} />
        {att.loading ? <Loading /> : att.data ? (
          <>
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <View><Text variant="number">{att.data.attended_30d}</Text><Text variant="caption" color={palette.ink2}>{mt('attended30')}</Text></View>
              <View><Text variant="number">{att.data.attendance_rate != null ? `${att.data.attendance_rate}%` : '—'}</Text><Text variant="caption" color={palette.ink2}>{mt('attendanceRate')}</Text></View>
            </View>
            <Text variant="small" color={palette.ink2}>
              {[att.data.streak_weeks ? mt('streak', { count: att.data.streak_weeks }) : mt('noStreak'),
                att.data.last_attended ? mt('lastClass', { date: dayShort(att.data.last_attended) }) : mt('neverAttended')].join(' · ')}
            </Text>
          </>
        ) : null}
      </Card>
      {(m.guardians.length || m.minors.length) ? (
        <Card style={box}>
          <SectionHeader title={m.guardians.length ? mt('guardians') : mt('minors')} action={link('guardians', mt('tab_guardians'))} />
          {[...m.guardians, ...m.minors].map((g) => (
            <View key={g.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Avatar name={fullName(g)} size={32} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{fullName(g)}</Text>
                <Text variant="caption" color={palette.ink2}>{mt(`rel_${g.relationship}`)}{'phone' in g && g.phone ? ` · ${g.phone}` : ''}</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
function AttendanceTab({ userId }: { userId: number }) {
  const stats = useApi(() => membersApi.attendance(userId), [userId]);
  const past = useApi(() => membersApi.pastBookings(userId), [userId]);
  const wide = useIsWide();
  if (stats.loading || past.loading) return <Loading />;
  if (stats.error) return <Notice tone="danger">{stats.error}</Notice>;
  const s = stats.data!;
  const tiles: [string, string][] = [
    [mt('attended30'), String(s.attended_30d)], [mt('attended90'), String(s.attended_90d)],
    [mt('attendedTotal'), String(s.attended_total)], [mt('attendanceRate'), s.attendance_rate != null ? `${s.attendance_rate}%` : '—'],
  ];
  const tone = { attended: 'success', no_show: 'danger', late_cancel: 'warning' } as const;
  return (
    <View style={{ gap: space.lg }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {tiles.map(([l, v]) => (
          <Card key={l} style={{ flexGrow: 1, flexBasis: wide ? 180 : 140, minWidth: 0 }} padding={16}>
            <Text variant="small" color={palette.ink2}>{l}</Text>
            <Text variant="number">{v}</Text>
          </Card>
        ))}
      </View>
      <Text variant="small" color={palette.ink2}>
        {[s.streak_weeks ? mt('streak', { count: s.streak_weeks }) : mt('noStreak'), ...s.by_discipline.map((d) => `${d.discipline}: ${d.attended}`)].join(' · ')}
      </Text>
      <Card>
        <SectionHeader title={mt('recentClasses')} />
        {(past.data ?? []).length === 0 ? <EmptyState icon="calendar" title={mt('noClasses')} /> : (past.data ?? []).map((b, i) => (
          <View key={b.booking_id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
              <Text variant="small" color={palette.ink2} style={{ width: 64 }}>{dayShort(b.session_date)}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body" numberOfLines={1}>{b.title}</Text>
                {b.instructor_name ? <Text variant="caption" color={palette.ink2} numberOfLines={1}>{b.instructor_name}</Text> : null}
              </View>
              <Badge label={mt(`b_${b.status}`)} tone={tone[b.status as keyof typeof tone] ?? 'neutral'} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
function DataTab({ m, canEdit, isAdmin, onSaved }: { m: Member; canEdit: boolean; isAdmin: boolean; onSaved: (m: Member) => void }) {
  const [v, setV] = useState<PersonValue>(m);
  const [memberNumber, setMemberNumber] = useState(m.member_number ?? '');
  const [joinedAt, setJoinedAt] = useState<string | null>(m.joined_at);
  const [notes, setNotes] = useState(m.notes ?? '');
  const [roles, setRoles] = useState<Role[]>(m.roles);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setV(m); setRoles(m.roles); }, [m]);

  async function save() {
    setMsg(null); setErrors({});
    if (!v.first_name?.trim()) { setErrors({ first_name: mt('required') }); return; }
    const body: Record<string, unknown> = profileDiff(m, v);
    const email = v.email?.trim().toLowerCase() || null;
    if (email !== (m.email ?? null)) body.email = email;
    if ((memberNumber.trim() || null) !== (m.member_number ?? null)) body.member_number = memberNumber.trim() || null;
    if (joinedAt !== m.joined_at) body.joined_at = joinedAt;
    if ((notes.trim() || null) !== (m.notes ?? null)) body.notes = notes.trim() || null;
    const rolesChanged = isAdmin && [...roles].sort().join() !== [...m.roles].sort().join();
    if (!Object.keys(body).length && !rolesChanged) { setMsg({ tone: 'success', text: mt('saved') }); return; }
    setSaving(true);
    try {
      let updated = m;
      if (Object.keys(body).length) updated = await membersApi.update(m.id, body);
      if (rolesChanged) { await membersApi.setRoles(m.id, roles); updated = await membersApi.get(m.id); }
      onSaved(updated);
      setMsg({ tone: 'success', text: mt('saved') });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SHARED_PROFILE') setMsg({ tone: 'danger', text: mt('sharedProfile') });
      else {
        if (e instanceof ApiError) setErrors(Object.fromEntries((e.details ?? []).map((d) => [d.field, d.message])));
        setMsg({ tone: 'danger', text: errorMessage(e) });
      }
    } finally { setSaving(false); }
  }

  if (!canEdit) {
    // Solo lectura (instructor): lo esencial para la clase
    const rows: [string, string | null | undefined][] = [
      [mt('dob'), m.date_of_birth ? dayShort(m.date_of_birth) : null], [mt('phone'), m.phone], [mt('email'), m.email],
      [mt('emergencyName'), m.emergency_contact_name], [mt('emergencyPhone'), m.emergency_contact_phone], [mt('bloodType'), m.blood_type], [mt('medical'), m.medical_notes],
    ];
    return (
      <Card>
        {rows.filter(([, x]) => x).map(([l, x], i) => (
          <View key={l}>{i > 0 ? <Divider /> : null}
            <View style={{ paddingVertical: space.xs, gap: 2 }}><Text variant="caption" color={palette.ink2}>{l}</Text><Text>{x}</Text></View>
          </View>
        ))}
      </Card>
    );
  }

  return (
    <View style={{ gap: space.lg }}>
      <Card style={{ gap: space.lg }}>
        <PersonForm value={v} onChange={setV} errors={errors} showEmail sections={['person', 'contact', 'emergency', 'address']} />
      </Card>
      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong" accessibilityRole="header">{mt('sectionDojo')}</Text>
        {isAdmin ? (
          <View style={{ gap: 6 }}>
            <Text variant="smallStrong">{mt('roles')}</Text>
            <RoleToggles value={roles} onChange={setRoles}
              allowed={[...(m.roles.includes('owner') ? ['owner'] : []), 'student', 'guardian', 'instructor', 'staff', 'admin'] as Role[]} />
          </View>
        ) : null}
        <FormGrid>
          <Field label={mt('memberNumber')} value={memberNumber} onChangeText={setMemberNumber} />
          <DateField label={mt('joinedAt')} value={joinedAt} onChange={setJoinedAt} />
        </FormGrid>
        <Field label={mt('notes')} value={notes} onChangeText={setNotes} hint={mt('notesHint')} multiline style={{ minHeight: 72, paddingVertical: 12, textAlignVertical: 'top' }} />
      </Card>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <Button label={t('common.save')} variant="dark" icon="check" loading={saving} onPress={save} style={{ alignSelf: 'flex-end' }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
function GuardiansTab({ m, canEdit, onChanged }: { m: Member; canEdit: boolean; onChanged: () => void }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState<PickedPerson | null>(null);
  const [rel, setRel] = useState<string>('legal_guardian');
  const [canBook, setCanBook] = useState(true);
  const [canPay, setCanPay] = useState(true);
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!who) return;
    setBusy(true); setErr(null);
    try { await membersApi.addGuardian(m.id, { guardian_user_id: who.id, relationship: rel, can_book: canBook, can_pay: canPay }); setAdding(false); setWho(null); onChanged(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true); setErr(null);
    try { await membersApi.removeGuardian(m.id, removing.id); setRemoving(null); onChanged(); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <SectionHeader title={mt('guardians')} action={canEdit ? <Button label={mt('addGuardian')} size="sm" variant="secondary" icon="plus" onPress={() => { setErr(null); setAdding(true); }} /> : undefined} />
        {m.guardians.length === 0 ? <Text color={palette.ink2}>{mt('noGuardians')}</Text> : m.guardians.map((g, i) => (
          <View key={g.user_id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
              <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${g.user_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1, minWidth: 0 }}>
                <Avatar name={fullName(g)} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{fullName(g)}</Text>
                  <Text variant="caption" color={palette.ink2} numberOfLines={1}>
                    {[mt(`rel_${g.relationship}`), g.phone, g.email].filter(Boolean).join(' · ')}
                  </Text>
                  <Text variant="caption" color={palette.ink2}>{[g.can_book ? mt('canBook') : null, g.can_pay ? mt('canPay') : null].filter(Boolean).join(' · ')}</Text>
                </View>
              </Pressable>
              {canEdit ? <Button label={mt('remove')} size="sm" variant="ghost" onPress={() => setRemoving({ id: g.user_id, name: fullName(g) })} /> : null}
            </View>
          </View>
        ))}
      </Card>
      {m.minors.length ? (
        <Card>
          <SectionHeader title={mt('minors')} />
          {m.minors.map((x, i) => (
            <View key={x.user_id}>
              {i > 0 ? <Divider /> : null}
              <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${x.user_id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
                <Avatar name={fullName(x)} size={36} />
                <Text variant="bodyStrong" style={{ flex: 1 }}>{fullName(x)}</Text>
                <Text variant="caption" color={palette.ink2}>{mt(`rel_${x.relationship}`)}</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
      {err && !adding && !removing ? <Notice tone="danger">{err}</Notice> : null}

      <Dialog visible={adding} onClose={() => setAdding(false)} title={mt('addGuardian')}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setAdding(false)} /><Button label={mt('addGuardian')} loading={busy} disabled={!who} onPress={add} /></>}>
        <View style={{ gap: space.md }}>
          <PersonPicker label={mt('guardian')} value={who} onChange={setWho} exclude={[m.id, ...m.guardians.map((g) => g.user_id)]} />
          <Select label={mt('relationship')} value={rel} onChange={(v) => v && setRel(v)}
            options={['mother', 'father', 'legal_guardian', 'grandparent', 'other'].map((r) => ({ value: r, label: mt(`rel_${r}`) }))} />
          <SwitchRow label={mt('canBook')} value={canBook} onChange={setCanBook} />
          <SwitchRow label={mt('canPay')} value={canPay} onChange={setCanPay} />
          {err ? <Notice tone="danger">{err}</Notice> : null}
        </View>
      </Dialog>
      <Dialog visible={!!removing} onClose={() => setRemoving(null)} title={removing ? mt('removeGuardianTitle', { name: removing.name }) : ''}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setRemoving(null)} /><Button label={mt('remove')} variant="danger" loading={busy} onPress={remove} /></>}>
        <Text color={palette.ink2}>{mt('removeGuardianBody')}</Text>
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </Dialog>
    </View>
  );
}

// ---------------------------------------------------------------------------
export function MemberDetail() {
  useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; tab?: string; created?: string }>();
  const id = Number(params.id);
  const { hasRole, user } = useSession();
  const wide = useIsWide();
  const isAdmin = hasRole('admin');
  const isStaff = hasRole('admin', 'staff');
  const canRank = hasRole('admin', 'instructor');

  const member = useApi(() => membersApi.get(id), [id]);
  const structure = useApi(() => membersApi.structure(), []);
  const [tab, setTab] = useState<TabKey>((params.tab as TabKey) || 'summary');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(params.created ? { tone: 'success', text: mt('created') } : null);
  const [pay, setPay] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // fuerza recarga de pestañas tras un cambio

  const m = member.data;
  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string }[] = [
      { key: 'summary', label: mt('tab_summary') }, { key: 'ranks', label: mt('tab_ranks') },
    ];
    if (isStaff) list.push({ key: 'billing', label: mt('tab_billing') });
    list.push({ key: 'attendance', label: mt('tab_attendance') }, { key: 'data', label: mt('tab_data') });
    if (m && (m.is_minor || m.guardians.length || m.minors.length || isStaff)) list.push({ key: 'guardians', label: mt('tab_guardians') });
    return list;
  }, [isStaff, m]);

  if (member.loading) return <Loading />;
  if (member.error || !m) {
    return <Screen><Notice tone="danger">{member.error ?? '404'}</Notice><Button label={mt('back')} variant="secondary" onPress={() => router.replace('/members')} /></Screen>;
  }
  const name = fullName(m);
  const refresh = () => { member.reload(); setVersion((x) => x + 1); };

  async function act(kind: 'approve' | 'reactivate' | 'access' | 'leave') {
    setBusy(kind); setNotice(null);
    try {
      if (kind === 'approve' || kind === 'reactivate') { const u = await membersApi.update(id, { status: 'active' }); member.setData(u); setNotice({ tone: 'success', text: kind === 'approve' ? mt('approved') : mt('saved') }); }
      if (kind === 'access') { await membersApi.sendAccess(id); setNotice({ tone: 'success', text: mt('accessSent') }); }
      if (kind === 'leave') { await membersApi.deactivate(id, reason.trim() || undefined); setLeaving(false); setReason(''); member.reload(); setNotice({ tone: 'success', text: mt('deactivated') }); }
    } catch (e) { setNotice({ tone: 'danger', text: errorMessage(e) }); if (kind === 'leave') setLeaving(false); } finally { setBusy(null); }
  }

  const meta = [
    m.age != null ? mt('age', { count: m.age }) : null,
    m.member_number ? `#${m.member_number}` : null,
    m.joined_at ? mt('memberSince', { date: dayShort(m.joined_at) }) : null,
  ].filter(Boolean).join(' · ');
  const access = m.can_login ? (m.last_login_at ? mt('lastLogin', { date: dateTimeShort(m.last_login_at) }) : mt('hasAccess')) : (m.email ? mt('neverLoggedIn') : mt('noAccess'));

  return (
    <Screen>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/members'))} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{mt('back')}</Text>
      </Pressable>

      {/* Encabezado */}
      <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
        {isStaff ? <PhotoPicker overlay name={name} photoUrl={m.photo_url} userId={m.id} size={wide ? 84 : 64} onUploaded={(url) => member.setData({ ...m, photo_url: url })} />
          : <Avatar name={name} photoUrl={m.photo_url} size={wide ? 84 : 64} />}
        <View style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <Text variant="title" accessibilityRole="header">{name}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <StatusBadge status={m.status} />
            {m.is_minor ? <Badge label={mt('minor')} tone="info" /> : null}
            {m.roles.filter((r) => r !== 'admin' || !m.roles.includes('owner')).map((r) => <Badge key={r} label={t(`roles.${r}`)} />)}
          </View>
          {meta ? <Text variant="small" color={palette.ink2}>{meta}</Text> : null}
          <Text variant="caption" color={palette.ink2} numberOfLines={2}>{access}{m.email ? ` · ${m.email}` : ''}</Text>
        </View>
      </View>

      {isStaff ? (
        <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
          {m.status === 'pending' ? <Button label={mt('approve')} icon="check" loading={busy === 'approve'} onPress={() => act('approve')} /> : null}
          {m.status === 'active' ? <Button label={mt('registerPayment')} icon="dollar-sign" onPress={() => setPay(true)} /> : null}
          {m.email && m.id !== user?.id ? <Button label={mt('resendAccess')} variant="secondary" icon="mail" loading={busy === 'access'} onPress={() => act('access')} /> : null}
          {m.status === 'inactive' ? <Button label={mt('reactivate')} variant="secondary" icon="rotate-ccw" loading={busy === 'reactivate'} onPress={() => act('reactivate')} />
            : isAdmin && m.id !== user?.id ? <Button label={mt('deactivate')} variant="danger" icon="user-x" onPress={() => setLeaving(true)} /> : null}
        </View>
      ) : null}

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      {m.status === 'pending' ? <Notice tone="warning">{mt('pendingNotice')}</Notice> : null}
      {m.status === 'inactive' && m.left_at ? <Notice tone="info">{mt('inactiveNotice', { date: dayShort(m.left_at) }) + (m.left_reason ? ` · ${m.left_reason}` : '')}</Notice> : null}
      <MedicalAlert m={m} />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <View key={`${tab}-${version}`}>
        {tab === 'summary' ? <SummaryTab m={m} financial={isStaff} go={setTab} /> : null}
        {tab === 'ranks' ? <RanksTab userId={m.id} canEdit={canRank && m.status === 'active'} canFix={isAdmin} structure={(structure.data ?? []) as DisciplineDef[]} onChanged={() => member.reload()} /> : null}
        {tab === 'billing' && isStaff ? <BillingTab userId={m.id} name={name} onChanged={() => member.reload()} /> : null}
        {tab === 'attendance' ? <AttendanceTab userId={m.id} /> : null}
        {tab === 'data' ? <DataTab m={m} canEdit={isStaff} isAdmin={isAdmin} onSaved={(u) => member.setData(u)} /> : null}
        {tab === 'guardians' ? <GuardiansTab m={m} canEdit={isStaff} onChanged={refresh} /> : null}
      </View>

      <PaymentDialog visible={pay} userId={m.id} name={name} suggested={(m.balance_due ?? 0) > 0 ? m.balance_due : undefined}
        onClose={() => setPay(false)} onSaved={() => { setPay(false); setNotice({ tone: 'success', text: mt('paymentSaved') }); refresh(); }} />
      <Dialog visible={leaving} onClose={() => setLeaving(false)} title={mt('deactivateTitle', { name })}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setLeaving(false)} /><Button label={mt('deactivate')} variant="danger" loading={busy === 'leave'} onPress={() => act('leave')} /></>}>
        <Text color={palette.ink2}>{mt('deactivateBody')}</Text>
        <Field label={mt('deactivateReason')} value={reason} onChangeText={setReason} />
      </Dialog>
    </Screen>
  );
}
