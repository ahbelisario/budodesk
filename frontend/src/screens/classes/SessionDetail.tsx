/**
 * Detalle de una clase.
 * Personal: pase de lista, código de llegada, notas, editar/cancelar.
 * Alumno/tutor: datos de la clase, reservar/cancelar y registrar llegada con código.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { classesApi, addDaysYmd, mondayOf, type RosterEntry, type Session, type SessionDetail as Detail } from '../../api/classes';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Avatar, Badge, Button, Card, Divider, EmptyState, Field, Icon, Loading, Notice, SectionHeader, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { palette, radius, space, fonts } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dateTimeShort, dayLong, fullName, hm } from '../../utils/format';
import { ViewAs } from '../StudentHome';
import { PersonPicker, type PickedPerson } from '../members/PersonPicker';
import { SessionDialog } from './ClassForms';
import { BookButton, useBooking } from './Schedule';
import { ageLabel, ct, myBookingBadge, spotsLabel, statusBadge } from './bits';

type Mark = 'attended' | 'no_show' | 'booked';
type Msg = { tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null;

function InfoRow({ icon, children }: { icon: React.ComponentProps<typeof Icon>['name']; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
      <Icon name={icon} size={16} color={palette.ink2} />
      <Text variant="body" style={{ flexShrink: 1 }}>{children}</Text>
    </View>
  );
}

function Header({ s }: { s: Pick<Detail, 'title' | 'session_date' | 'start_time' | 'end_time' | 'discipline' | 'instructor_name' | 'location' | 'color' | 'status' | 'cancel_reason' | 'min_age' | 'max_age' | 'description'> & { is_past?: boolean } }) {
  const { accent } = useTheme();
  const st = statusBadge({ status: s.status, is_past: !!s.is_past });
  const ages = ageLabel(s.min_age, s.max_age);
  return (
    <Card style={{ gap: space.sm, borderLeftWidth: 5, borderLeftColor: s.color ?? accent }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Text variant="title" accessibilityRole="header" style={{ flexShrink: 1 }}>{s.title}</Text>
        {st ? <Badge label={st.label} tone={st.tone} /> : null}
        {ages ? <Badge label={ages} tone="info" /> : null}
      </View>
      <InfoRow icon="calendar">{dayLong(s.session_date)} · {hm(s.start_time)} – {hm(s.end_time)}</InfoRow>
      {s.discipline ? <InfoRow icon="award">{s.discipline}</InfoRow> : null}
      {s.instructor_name ? <InfoRow icon="user">{s.instructor_name}</InfoRow> : null}
      {s.location ? <InfoRow icon="map-pin">{s.location}</InfoRow> : null}
      {s.description ? <Text variant="small" color={palette.ink2}>{s.description}</Text> : null}
      {s.status === 'cancelled' && s.cancel_reason ? <Notice tone="danger">{ct('cancelledBecause', { reason: s.cancel_reason })}</Notice> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pase de lista
// ---------------------------------------------------------------------------
function Segmented({ value, onChange, disabled }: { value: Mark; onChange: (v: Mark) => void; disabled?: boolean }) {
  const items: { k: Mark; label: string; color: string; bg: string }[] = [
    { k: 'attended', label: ct('present'), color: '#FFFFFF', bg: palette.success },
    { k: 'no_show', label: ct('absent'), color: '#FFFFFF', bg: palette.danger },
  ];
  return (
    <View style={{ flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, overflow: 'hidden', opacity: disabled ? 0.5 : 1 }}>
      {items.map((it, i) => {
        const on = value === it.k;
        return (
          <Pressable key={it.k} accessibilityRole="radio" accessibilityState={{ selected: on, disabled }} disabled={disabled}
            onPress={() => onChange(on ? 'booked' : it.k)}
            style={{ paddingHorizontal: 12, height: 36, justifyContent: 'center', backgroundColor: on ? it.bg : palette.surface, borderLeftWidth: i ? 1 : 0, borderLeftColor: palette.line }}>
            <Text variant="smallStrong" color={on ? it.color : palette.ink2}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Roster({ s, onChanged }: { s: Detail; onChanged: () => void }) {
  const router = useRouter();
  const wide = useIsWide();
  const roster = s.roster ?? [];
  const active = roster.filter((r) => ['booked', 'attended', 'no_show'].includes(r.status));
  const waiting = roster.filter((r) => r.status === 'waitlisted');
  const late = roster.filter((r) => r.status === 'late_cancel');
  const initial = useMemo(() => Object.fromEntries(active.map((r) => [r.user_id, r.status as Mark])), [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const [marks, setMarks] = useState<Record<number, Mark>>(initial);
  const [added, setAdded] = useState<PickedPerson[]>([]);
  const [picker, setPicker] = useState<PickedPerson | null>(null);
  const [saving, setSaving] = useState<'save' | 'close' | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => { setMarks(initial); setAdded([]); }, [initial]);

  const locked = s.status === 'cancelled';
  const changed = active.filter((r) => marks[r.user_id] !== r.status).map((r) => ({ user_id: r.user_id, status: marks[r.user_id] }));
  const entries = [...changed, ...added.map((p) => ({ user_id: p.id, status: 'attended' as Mark }))];
  const present = active.filter((r) => marks[r.user_id] === 'attended').length + added.length;
  const unmarked = active.filter((r) => marks[r.user_id] === 'booked').length;

  async function save(complete: boolean) {
    setSaving(complete ? 'close' : 'save'); setMsg(null); setClosing(false);
    try {
      await classesApi.attendance(s.id, entries, complete);
      setMsg({ tone: 'success', text: complete ? ct('closed') : ct('attendanceSaved') });
      onChanged();
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setSaving(null); }
  }

  function addPerson(p: PickedPerson | null) {
    setPicker(null);
    if (!p) return;
    const existing = roster.find((r) => r.user_id === p.id);
    if (existing && ['booked', 'attended', 'no_show'].includes(existing.status)) { setMarks((m) => ({ ...m, [p.id]: 'attended' })); return; }
    if (!added.some((a) => a.id === p.id)) setAdded((a) => [...a, p]);
  }

  const row = (r: RosterEntry, right: React.ReactNode) => {
    const name = fullName(r);
    return (
      <View key={r.booking_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
        <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${r.user_id}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1, minWidth: 0 }}>
          <Avatar name={name} photoUrl={r.photo_url} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Text>
              {r.has_medical_notes ? <View accessibilityLabel={ct('medical')}><Icon name="alert-triangle" size={14} color={palette.danger} /></View> : null}
            </View>
            <Text variant="caption" color={palette.ink2} numberOfLines={1}>
              {[r.rank_name, r.age != null ? t('members.age', { count: r.age }) : null, r.checkin_method === 'qr' && r.checked_in_at ? `${ct('viaCode')} ${dateTimeShort(r.checked_in_at).split(', ').pop()}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
        {right}
      </View>
    );
  };

  return (
    <Card style={{ gap: space.sm }}>
      <SectionHeader title={ct('roster')} action={<Text variant="small" color={palette.ink2}>{ct('rosterCount', { present, total: active.length + added.length })}</Text>} />
      {active.length === 0 && added.length === 0 ? <Text color={palette.ink2}>{ct('rosterEmpty')}</Text> : null}
      {active.map((r, i) => (
        <View key={r.booking_id}>
          {i > 0 ? <Divider /> : null}
          {row(r, <Segmented value={marks[r.user_id] ?? 'booked'} onChange={(v) => setMarks((m) => ({ ...m, [r.user_id]: v }))} disabled={locked} />)}
        </View>
      ))}
      {added.map((p) => (
        <View key={`a${p.id}`}>
          <Divider />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
            <Avatar name={p.name} photoUrl={p.photo_url} size={40} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>{p.name}</Text>
            <Badge label={ct('present')} tone="success" />
            <Button label={t('members.remove')} size="sm" variant="ghost" onPress={() => setAdded((a) => a.filter((x) => x.id !== p.id))} />
          </View>
        </View>
      ))}

      {!locked ? (
        <View style={{ gap: space.sm, marginTop: space.xs }}>
          <View style={{ maxWidth: wide ? 360 : undefined }}>
            <PersonPicker label={ct('addWalkIn')} value={picker} onChange={addPerson} exclude={[...active.map((r) => r.user_id), ...added.map((a) => a.id)]} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
            {unmarked ? <Button label={ct('allPresent')} size="sm" variant="secondary" icon="check-circle"
              onPress={() => setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v === 'booked' ? 'attended' : v])) as Record<number, Mark>)} /> : null}
            <View style={{ flex: 1 }} />
            <Button label={ct('saveAttendance')} variant="secondary" icon="save" disabled={!entries.length} loading={saving === 'save'} onPress={() => save(false)} />
            {s.status === 'scheduled' ? <Button label={ct('closeClass')} variant="dark" icon="check" loading={saving === 'close'} onPress={() => setClosing(true)} /> : null}
          </View>
          {entries.length ? <Text variant="caption" color={palette.warning}>{ct('unsaved')}</Text> : null}
        </View>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      {waiting.length ? (
        <View style={{ gap: 4, marginTop: space.sm }}>
          <Text variant="overline" color={palette.ink2}>{ct('waitingList')}</Text>
          {waiting.map((r) => row(r, <Badge label={`#${r.waitlist_position}`} tone="warning" />))}
        </View>
      ) : null}
      {late.length ? (
        <View style={{ gap: 4, marginTop: space.sm }}>
          <Text variant="overline" color={palette.ink2}>{ct('lateCancel')}</Text>
          {late.map((r) => row(r, <Badge label={ct('lateCancel')} />))}
        </View>
      ) : null}

      <Dialog visible={closing} title={ct('closeTitle')} onClose={() => setClosing(false)}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setClosing(false)} /><Button label={ct('closeClass')} variant="dark" onPress={() => save(true)} /></>}>
        <Text color={palette.ink2}>{unmarked ? ct('closeBody', { count: unmarked }) : ct('closeBodyNone')}</Text>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function CheckinCode({ s, onChanged }: { s: Detail; onChanged: (code: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function gen() {
    setBusy(true); setErr(null);
    try { onChanged((await classesApi.newCode(s.id)).code); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card style={{ gap: space.sm }}>
      <SectionHeader title={ct('checkinCode')} />
      {s.checkin_code ? (
        <Text accessibilityLabel={`${ct('code')}: ${s.checkin_code.split('').join(' ')}`}
          style={{ fontFamily: fonts.display, fontSize: 44, lineHeight: 52, letterSpacing: 8, textAlign: 'center', paddingVertical: space.sm }}>{s.checkin_code}</Text>
      ) : null}
      <Text variant="small" color={palette.ink2}>{ct('checkinCodeHint')}</Text>
      <Button label={s.checkin_code ? ct('newCode') : ct('generateCode')} size="sm" variant={s.checkin_code ? 'secondary' : 'dark'} icon="hash" loading={busy} onPress={gen} style={{ alignSelf: 'flex-start' }} />
      {err ? <Notice tone="danger">{err}</Notice> : null}
    </Card>
  );
}

function Notes({ s, onSaved }: { s: Detail; onSaved: (d: Detail) => void }) {
  const [v, setV] = useState(s.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  async function save() {
    setBusy(true); setMsg(null);
    try { const d = await classesApi.updateSession(s.id, { notes: v.trim() || null }); onSaved(d); setMsg({ tone: 'success', text: ct('notesSaved') }); }
    catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }
  return (
    <Card style={{ gap: space.sm }}>
      <Field label={ct('notes')} value={v} onChangeText={setV} multiline hint={ct('notesHint')} style={{ minHeight: 96, paddingVertical: 12, textAlignVertical: 'top' }} />
      <Button label={ct('saveNotes')} size="sm" variant="secondary" disabled={(s.notes ?? '') === v} loading={busy} onPress={save} style={{ alignSelf: 'flex-start' }} />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function StaffView({ id }: { id: number }) {
  const wide = useIsWide();
  const { hasRole, user } = useSession();
  const manage = hasRole('admin', 'staff');
  const data = useApi(() => classesApi.session(id), [id]);
  const [edit, setEdit] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  if (data.loading) return <Loading />;
  if (data.error || !data.data) return <Notice tone="danger">{data.error ?? ''}</Notice>;
  const s = data.data;
  const canNotes = manage || s.instructor_id === user?.id;

  async function cancelClass() {
    setBusy(true); setMsg(null);
    try { const r = await classesApi.cancelSession(s.id, reason.trim() || undefined); setCancelOpen(false); setReason(''); setMsg({ tone: 'success', text: ct('classCancelled', { count: r.notified_users }) }); data.reload(); }
    catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); setCancelOpen(false); } finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true); setMsg(null);
    try { await classesApi.restoreSession(s.id); setMsg({ tone: 'success', text: ct('restored') }); data.reload(); }
    catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(false); }
  }

  return (
    <>
      <Header s={s} />
      <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge label={s.capacity != null ? `${ct('capacity')}: ${spotsLabel(s)}` : ct('noLimit')} />
        <View style={{ flex: 1 }} />
        {manage && s.status !== 'cancelled' ? <Button label={ct('edit')} size="sm" variant="secondary" icon="edit-2" onPress={() => setEdit(true)} /> : null}
        {manage && s.status === 'scheduled' ? <Button label={ct('cancelClass')} size="sm" variant="danger" icon="x-circle" onPress={() => setCancelOpen(true)} /> : null}
        {manage && s.status === 'cancelled' ? <Button label={ct('restore')} size="sm" variant="secondary" icon="rotate-ccw" loading={busy} onPress={restore} /> : null}
      </View>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 2 : undefined, alignSelf: 'stretch', gap: space.lg }}>
          <Roster s={s} onChanged={data.reload} />
        </View>
        <View style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch', gap: space.lg }}>
          {s.status === 'scheduled' ? <CheckinCode s={s} onChanged={(code) => data.setData({ ...s, checkin_code: code })} /> : null}
          {canNotes ? <Notes s={s} onSaved={(d) => data.setData({ ...s, notes: d.notes })} /> : null}
        </View>
      </View>

      <SessionDialog visible={edit} session={s} onClose={() => setEdit(false)} onSaved={(_, m) => { setEdit(false); setMsg({ tone: 'success', text: m }); data.reload(); }} />
      <Dialog visible={cancelOpen} title={ct('cancelClassTitle', { date: dayLong(s.session_date) })} onClose={() => setCancelOpen(false)}
        actions={<><Button label={ct('keep')} variant="ghost" onPress={() => setCancelOpen(false)} /><Button label={ct('cancelClass')} variant="danger" loading={busy} onPress={cancelClass} /></>}>
        <Text color={palette.ink2}>{ct('cancelClassBody')}</Text>
        <Field label={ct('cancelReason')} value={reason} onChangeText={setReason} />
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
function StudentView({ id }: { id: number }) {
  const { user, actingUserId, minors } = useSession();
  const uid = actingUserId ?? user!.id;
  const name = uid === user?.id ? (user?.first_name ?? '') : minors.find((m) => m.user_id === uid)?.first_name ?? '';
  const detail = useApi(() => classesApi.session(id), [id]);
  // Para saber el estado de MI reserva se consulta la semana de la clase
  const week = useApi(async () => {
    if (!detail.data) return null;
    const from = mondayOf(detail.data.session_date);
    return classesApi.sessions({ from, to: addDaysYmd(from, 6), user_id: uid, include_cancelled: true });
  }, [detail.data?.session_date, uid]);
  const s: Session | undefined = week.data?.data.find((x) => x.id === id);
  const bk = useBooking(uid, () => week.reload(), week.data?.meta.cancel_hours ?? 12);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (detail.loading || week.loading) return <Loading />;
  if (detail.error || !detail.data) return <Notice tone="danger">{detail.error ?? ''}</Notice>;
  const d = detail.data;
  const mine = s ? myBookingBadge(s) : null;
  const now = Date.now();
  const canCheckIn = s && s.status === 'scheduled' && s.my_booking !== 'attended' && s.my_booking !== 'waitlisted'
    && now >= new Date(s.starts_at).getTime() - 30 * 60000 && now <= new Date(s.ends_at).getTime();

  async function checkIn() {
    setBusy(true); setCodeErr(null);
    try { await classesApi.checkIn(id, uid, code.trim()); setCodeOpen(false); setCode(''); bk.setMsg({ tone: 'success', text: ct('checkedIn') }); week.reload(); }
    catch (e) { setCodeErr(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <ViewAs />
      <Header s={{ ...d, is_past: s?.is_past }} />
      {s && s.misfit_reason ? <Notice tone="warning">{ct(`misfit_${s.misfit_reason}`, { name })}</Notice> : null}
      {bk.msg ? <Notice tone={bk.msg.tone}>{bk.msg.text}</Notice> : null}
      {s ? (
        <Card style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            {mine ? <Badge label={mine.label} tone={mine.tone} /> : null}
            <Text variant="small" color={palette.ink2} style={{ flex: 1 }}>
              {s.capacity == null ? ct('noLimit') : s.spots_left ? ct('spotsLeft', { count: s.spots_left }) : ct('full')}
              {s.waitlist_count ? ` · ${ct('waitlist', { count: s.waitlist_count })}` : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
            {canCheckIn ? <Button label={ct('checkIn')} variant="dark" icon="log-in" onPress={() => { setCodeErr(null); setCodeOpen(true); }} /> : null}
            <BookButton s={s} busy={bk.busy === s.id} onBook={() => bk.book(s)} onCancel={() => bk.askCancel(s)} />
          </View>
          {s.is_past && !s.my_booking ? <Text variant="small" color={palette.ink2}>{ct('past')}</Text> : null}
        </Card>
      ) : <Card><EmptyState icon="calendar" title={ct('noClassesStudent')} /></Card>}
      {bk.dialog}
      <Dialog visible={codeOpen} title={ct('checkInTitle')} onClose={() => setCodeOpen(false)}
        actions={<><Button label={t('common.cancel')} variant="ghost" onPress={() => setCodeOpen(false)} /><Button label={ct('checkIn')} variant="dark" loading={busy} disabled={code.trim().length !== 6} onPress={checkIn} /></>}>
        <Text color={palette.ink2}>{ct('checkInBody')}</Text>
        <Field label={ct('code')} value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} autoCapitalize="characters" autoCorrect={false}
          style={{ fontFamily: fonts.display, fontSize: 24, letterSpacing: 6 }} error={codeErr} />
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
export function SessionDetail() {
  useLanguage();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isStaff } = useSession();
  return (
    <Screen maxWidth={1100}>
      <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/classes' as never))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{ct('back')}</Text>
      </Pressable>
      {isStaff ? <StaffView id={Number(id)} /> : <StudentView id={Number(id)} />}
    </Screen>
  );
}
