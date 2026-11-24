/**
 * Horario semanal. Personal: todas las clases con su ocupación.
 * Alumno/tutor: las clases que le corresponden, con reservar/cancelar.
 * Ancha: 7 columnas. Celular: tira de días + lista del día.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { classesApi, addDaysYmd, mondayOf, parseYmd, todayYmd, type Session } from '../../api/classes';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Badge, Button, Card, EmptyState, IconButton, Loading, Notice, Text } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { FilterChips, SwitchRow } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { useLanguage } from '../../i18n';
import { dayLong, dayShort, hm, weekdayShort } from '../../utils/format';
import { ViewAs } from '../StudentHome';
import { useClassOptions, SessionDialog } from './ClassForms';
import { SessionBlock, ageLabel, ct, myBookingBadge, spotsLabel, statusBadge } from './bits';

type Msg = { tone: 'success' | 'danger' | 'info'; text: string } | null;

/** Acción de reservar para alumno/tutor (lista del celular y detalle) */
export function useBooking(uid: number, onDone: () => void, cancelHours: number) {
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [confirm, setConfirm] = useState<Session | null>(null);

  async function book(s: Session) {
    setBusy(s.id); setMsg(null);
    try {
      const r = await classesApi.book(s.id, uid);
      setMsg({ tone: r.status === 'booked' ? 'success' : 'info', text: r.status === 'booked' ? ct('bookedOk') : ct('waitlistOk') });
      onDone();
    } catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(null); }
  }
  async function cancel() {
    if (!confirm) return;
    const s = confirm; setConfirm(null); setBusy(s.id); setMsg(null);
    try { await classesApi.cancelBooking(s.id, uid); setMsg({ tone: 'success', text: ct('cancelledOk') }); onDone(); }
    catch (e) { setMsg({ tone: 'danger', text: errorMessage(e) }); } finally { setBusy(null); }
  }
  const dialog = (
    <Dialog visible={!!confirm} title={ct('cancelTitle')} onClose={() => setConfirm(null)}
      actions={<><Button label={ct('keep')} variant="secondary" size="sm" onPress={() => setConfirm(null)} /><Button label={ct('cancelBooking')} variant="danger" size="sm" onPress={cancel} /></>}>
      {confirm ? <Text color={palette.ink2}>{confirm.title} · {dayLong(confirm.session_date)} {hm(confirm.start_time)}</Text> : null}
      {confirm && confirm.my_booking === 'booked' && !confirm.can_cancel_free
        ? <Notice tone="warning">{ct('cancelLate', { hours: cancelHours })}</Notice>
        : <Text variant="small" color={palette.ink2}>{ct('cancelFree')}</Text>}
    </Dialog>
  );
  return { busy, msg, setMsg, book, askCancel: setConfirm, dialog };
}

export function BookButton({ s, busy, onBook, onCancel }: { s: Session; busy: boolean; onBook: () => void; onCancel: () => void }) {
  if (s.status !== 'scheduled' || s.is_past || s.my_booking === 'attended') return null;
  if (s.my_booking === 'booked' || s.my_booking === 'waitlisted') {
    return <Button label={s.my_booking === 'booked' ? ct('cancelBooking') : ct('leaveWaitlist')} size="sm" variant="secondary" loading={busy} onPress={onCancel} />;
  }
  const full = s.capacity != null && s.booked_count >= s.capacity;
  return <Button label={full ? ct('joinWaitlist') : ct('book')} size="sm" variant={full ? 'secondary' : 'primary'} loading={busy} onPress={onBook} />;
}

/** Fila de clase para la lista del celular */
function SessionRow({ s, staff, onPress, action }: { s: Session; staff: boolean; onPress: () => void; action?: React.ReactNode }) {
  const { accent } = useTheme();
  const st = statusBadge(s);
  const mine = staff ? null : myBookingBadge(s);
  const full = s.capacity != null && s.booked_count >= s.capacity;
  const ages = ageLabel(s.min_age, s.max_age);
  return (
    <Card padding={0} style={{ overflow: 'hidden', opacity: s.status === 'cancelled' || s.is_past ? 0.65 : 1 }}>
      <Pressable accessibilityRole="link" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', backgroundColor: pressed ? palette.paper : 'transparent' })}>
        <View style={{ width: 4, backgroundColor: s.color ?? accent }} />
        <View style={{ flex: 1, padding: space.md, gap: 4, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <Text variant="smallStrong" color={palette.ink2}>{hm(s.start_time)} – {hm(s.end_time)}</Text>
            {st ? <Badge label={st.label} tone={st.tone} /> : mine ? <Badge label={mine.label} tone={mine.tone} /> : null}
          </View>
          <Text variant="bodyStrong" style={{ textDecorationLine: s.status === 'cancelled' ? 'line-through' : 'none' }}>{s.title}</Text>
          <Text variant="small" color={palette.ink2} numberOfLines={2}>
            {[s.discipline, s.instructor_name, s.location, ages].filter(Boolean).join(' · ')}
          </Text>
          {s.status === 'scheduled' ? (
            <Text variant="caption" color={full ? palette.danger : palette.ink2}>
              {s.capacity == null ? spotsLabel(s) : full ? `${ct('full')}${s.waitlist_count ? ` · ${ct('waitlist', { count: s.waitlist_count })}` : ''}` : staff ? spotsLabel(s) : ct('spotsLeft', { count: s.spots_left ?? 0 })}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {action ? <View style={{ paddingHorizontal: space.md, paddingBottom: space.md, flexDirection: 'row', justifyContent: 'flex-end' }}>{action}</View> : null}
    </Card>
  );
}

export function Schedule() {
  useLanguage();
  const router = useRouter();
  const { isStaff, hasRole, user, actingUserId, minors } = useSession();
  const wide = useIsWide();
  const { accent } = useTheme();
  const manage = hasRole('admin', 'staff');
  const isInstructor = hasRole('instructor');
  const staffView = isStaff;
  const uid = staffView ? user!.id : (actingUserId ?? user!.id);
  const actingName = uid === user?.id ? null : minors.find((m) => m.user_id === uid)?.first_name ?? null;

  const [monday, setMonday] = useState(mondayOf(todayYmd()));
  const [day, setDay] = useState(todayYmd());
  const [disc, setDisc] = useState<string>('all');
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyFit, setOnlyFit] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const opts = useClassOptions(manage);

  const sunday = addDaysYmd(monday, 6);
  const data = useApi(() => classesApi.sessions({
    from: monday, to: sunday,
    user_id: staffView ? undefined : uid,
    discipline_id: disc !== 'all' ? Number(disc) : undefined,
    instructor_id: staffView && onlyMine ? user!.id : undefined,
    only_fit: !staffView && onlyFit ? true : undefined,
    include_cancelled: true,
  }), [monday, disc, onlyMine, onlyFit, uid]);
  const bk = useBooking(uid, () => data.reload(), data.data?.meta.cancel_hours ?? 12);

  // Al cambiar de semana, en celular se elige hoy (si cae en la semana) o el lunes
  useEffect(() => {
    const today = todayYmd();
    setDay(today >= monday && today <= sunday ? today : monday);
  }, [monday]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysYmd(monday, i)), [monday]);
  const byDay = useMemo(() => {
    const m: Record<string, Session[]> = {};
    days.forEach((d) => { m[d] = []; });
    (data.data?.data ?? []).forEach((s) => { (m[s.session_date] ??= []).push(s); });
    return m;
  }, [data.data, days]);
  const total = data.data?.data.length ?? 0;
  const today = todayYmd();
  const open = (s: Session) => router.push(`/classes/${s.id}` as never);

  const discOptions = [{ key: 'all', label: ct('allDisciplines') }, ...opts.disciplines.map((d) => ({ key: String(d.value), label: d.label }))];

  return (
    <Screen maxWidth={1400} onRefresh={data.reload}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: 2 }}>
          <Text variant="title" accessibilityRole="header">{ct('title')}</Text>
          <Text variant="small" color={palette.ink2}>{ct('week', { from: dayShort(monday), to: dayShort(sunday) })}</Text>
        </View>
        {manage ? (
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
            <Button label={ct('schedules')} variant="secondary" icon="repeat" onPress={() => router.push('/classes/schedules' as never)} />
            <Button label={ct('newClass')} icon="plus" onPress={() => setNewOpen(true)} />
          </View>
        ) : null}
      </View>

      {!staffView ? <ViewAs /> : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' }}>
        <IconButton icon="chevron-left" label={ct('prevWeek')} onPress={() => setMonday(addDaysYmd(monday, -7))} />
        <Button label={ct('thisWeek')} size="sm" variant={monday === mondayOf(today) ? 'dark' : 'secondary'} onPress={() => setMonday(mondayOf(today))} />
        <IconButton icon="chevron-right" label={ct('nextWeek')} onPress={() => setMonday(addDaysYmd(monday, 7))} />
        <View style={{ flex: 1 }} />
        {discOptions.length > 2 ? <FilterChips label={ct('discipline')} options={discOptions} value={disc} onChange={setDisc} /> : null}
      </View>
      {staffView && isInstructor ? <View style={{ maxWidth: 360 }}><SwitchRow label={ct('onlyMine')} value={onlyMine} onChange={setOnlyMine} /></View> : null}
      {!staffView ? (
        <View style={{ maxWidth: 420 }}>
          <SwitchRow label={actingName ? ct('onlyFitFor', { name: actingName }) : ct('onlyFit')} value={onlyFit} onChange={setOnlyFit} />
        </View>
      ) : null}

      {bk.msg ? <Notice tone={bk.msg.tone}>{bk.msg.text}</Notice> : null}
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}

      {data.loading ? <Loading /> : total === 0 ? (
        <Card><EmptyState icon="calendar" title={staffView ? ct('noClasses') : ct('noClassesStudent')} body={manage ? ct('noClassesBody') : undefined}
          action={manage ? <Button label={ct('newSeries')} icon="plus" onPress={() => router.push('/classes/schedules?new=1' as never)} /> : undefined} /></Card>
      ) : wide ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
          {days.map((d) => {
            const isToday = d === today;
            return (
              <View key={d} style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                <View style={{ alignItems: 'center', paddingVertical: 6, borderRadius: radius.md, backgroundColor: isToday ? accent : 'transparent' }}>
                  <Text variant="caption" color={isToday ? '#FFFFFF' : palette.ink2}>{weekdayShort(d)}</Text>
                  <Text variant="heading" color={isToday ? '#FFFFFF' : palette.ink}>{parseYmd(d).getDate()}</Text>
                </View>
                {byDay[d].length === 0 ? <Text variant="caption" color={palette.ink3} style={{ textAlign: 'center', paddingVertical: space.sm }}>—</Text>
                  : byDay[d].map((s) => <SessionBlock key={s.id} s={s} staff={staffView} onPress={() => open(s)} />)}
              </View>
            );
          })}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityRole="tablist">
            {days.map((d) => {
              const on = d === day;
              const n = byDay[d].filter((s) => s.status !== 'cancelled').length;
              return (
                <Pressable key={d} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={dayLong(d)} onPress={() => setDay(d)}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: radius.md, borderWidth: 1,
                    borderColor: on ? palette.ink : d === today ? accent : palette.line, backgroundColor: on ? palette.ink : palette.surface }}>
                  <Text variant="caption" color={on ? '#FFFFFF' : palette.ink2}>{weekdayShort(d)}</Text>
                  <Text variant="bodyStrong" color={on ? '#FFFFFF' : palette.ink}>{parseYmd(d).getDate()}</Text>
                  <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 2, backgroundColor: n ? (on ? '#FFFFFF' : accent) : 'transparent' }} />
                </Pressable>
              );
            })}
          </View>
          <Text variant="bodyStrong">{dayLong(day)}</Text>
          {byDay[day]?.length ? byDay[day].map((s) => (
            <SessionRow key={s.id} s={s} staff={staffView} onPress={() => open(s)}
              action={staffView || s.status !== 'scheduled' || s.is_past || s.my_booking === 'attended' ? undefined
                : <BookButton s={s} busy={bk.busy === s.id} onBook={() => bk.book(s)} onCancel={() => bk.askCancel(s)} />} />
          )) : <Text color={palette.ink2}>{ct('noClassesDay')}</Text>}
        </>
      )}

      {bk.dialog}
      {manage ? <SessionDialog visible={newOpen} session={null} defaultDate={wide ? undefined : day} onClose={() => setNewOpen(false)}
        onSaved={(s) => { setNewOpen(false); router.push(`/classes/${s.id}` as never); }} /> : null}
    </Screen>
  );
}
