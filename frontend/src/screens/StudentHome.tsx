/**
 * Inicio del alumno (y del tutor, que puede cambiar a la vista de sus menores).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../session/SessionProvider';
import { studentHome, type Booking, type MyMembership, type RankProgress, type Session } from '../api/home';
import { useApi } from '../utils/useApi';
import { onlineApi } from '../api/online';
import { Screen } from '../ui/Screen';
import { Dialog } from '../ui/Dialog';
import { Badge, Belt, Button, Card, Divider, Field, IconButton, Loading, Notice, ProgressBar, SectionHeader, Text } from '../ui/primitives';
import { DojoMark, useIsWide } from '../navigation/AppShell';
import { palette, radius, space, fonts } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { t } from '../i18n';
import { dayLong, dayShort, hm, money, parseDay, weekdayShort } from '../utils/format';
import { errorMessage } from '../utils/errors';
import { PushNudge } from '../push/PushNudge';

// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function thisWeek() {
  const today = new Date();
  const end = new Date(today);
  end.setDate(today.getDate() + ((7 - today.getDay()) % 7)); // hasta el domingo
  if (end.getTime() - today.getTime() < 2 * 86400000) end.setDate(end.getDate() + 7); // si ya es fin de semana, muestra la siguiente
  return { from: ymd(today), to: ymd(end) };
}

// ---------------------------------------------------------------------------
// Ver como (tutor → menores)
// ---------------------------------------------------------------------------
export function ViewAs() {
  const { user, minors, actingUserId, setActingUser, hasRole } = useSession();
  if (!user || minors.length === 0) return null;
  const people = [
    ...(hasRole('student') ? [{ id: user.id, label: `${t('nav.me')} · ${user.first_name}` }] : []),
    ...minors.map((m) => ({ id: m.user_id, label: m.first_name })),
  ];
  if (people.length < 2) return null;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('home.viewAs')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
      {people.map((p) => {
        const on = p.id === actingUserId;
        return (
          <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setActingUser(p.id)}
            style={{ height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center',
              borderColor: on ? palette.ink : palette.line, backgroundColor: on ? palette.ink : palette.surface }}>
            <Text variant="smallStrong" color={on ? '#FFFFFF' : palette.ink}>{p.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Grado
// ---------------------------------------------------------------------------
function Metric({ label, value, pct, ok }: { label: string; value: string; pct: number; ok: boolean }) {
  return (
    <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
      <Text variant="caption" color={palette.mutedOnDark}>{label}</Text>
      <Text variant="bodyStrong" color="#FFFFFF">{value}</Text>
      <ProgressBar value={pct / 100} color={ok ? '#86EFAC' : '#FFFFFF'} track={palette.darkLine} height={5} label={label} />
    </View>
  );
}

function RankCard({ r }: { r: RankProgress }) {
  const router = useRouter();
  const belt = r.display_style === 'belt';
  const p = r.progress;
  const stripes = r.current.stripes ? t('home.stripes', { count: r.current.stripes }) : null;
  return (
    <Card dark padding={20} style={{ gap: 18 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="overline" color={palette.mutedOnDark}>{r.discipline}{r.track !== 'General' ? ` · ${r.track}` : ''}</Text>
          <Text style={{ fontFamily: fonts.display, fontSize: 32, lineHeight: 38 }} color="#FFFFFF">{r.current.name}</Text>
          <Text variant="small" color="#D6D2C7">{[t('home.rankSince', { date: dayShort(r.current.since_date) }), stripes].filter(Boolean).join(' · ')}</Text>
        </View>
        {!belt ? <View style={{ paddingTop: 8 }}><Belt color={r.current.color} stripeColor={r.current.stripe_color} stripes={r.current.stripes} onDark /></View> : null}
      </View>
      {belt ? <Belt size="lg" color={r.current.color} stripeColor={r.current.stripe_color} stripes={r.current.stripes} onDark /> : null}

      {r.next && p ? (
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
            <Text variant="small" color="#D6D2C7">{t('home.towards')} <Text variant="smallStrong" color="#FFFFFF">{r.next.name}</Text></Text>
            {p.eligible ? <Badge label={t('home.readyForExam')} tone="success" /> : r.next_exam_date ? <Badge label={t('home.nextExamDate', { date: dayShort(r.next_exam_date) })} tone="dark" /> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {p.months.need ? <Metric label={t('home.time')} value={t('home.months', { have: Math.min(p.months.have, p.months.need), need: p.months.need })} pct={p.months.pct} ok={p.months.ok} /> : null}
            {p.classes.need ? <Metric label={t('home.classes')} value={t('home.ofClasses', { have: p.classes.have, need: p.classes.need })} pct={p.classes.pct} ok={p.classes.ok} /> : null}
            {p.requirements.total ? <Metric label={t('home.syllabus')} value={t('home.ofClasses', { have: p.requirements.approved, need: p.requirements.total })} pct={p.requirements.pct} ok={p.requirements.ok} /> : null}
          </View>
          {p.requirements.total ? (
            <Pressable accessibilityRole="link" onPress={() => router.push('/progress')}>
              <Text variant="smallStrong" color="#FFFFFF" style={{ textDecorationLine: 'underline' }}>{t('home.seeSyllabus')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : <Text variant="small" color="#D6D2C7">{t('home.maxRank')}</Text>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Próxima clase
// ---------------------------------------------------------------------------
function NextClass({ b, session, onCancel, onCheckIn }: { b: Booking; session?: Session; onCancel: () => void; onCheckIn: () => void }) {
  const now = Date.now();
  const canCheckIn = b.status === 'booked' && !b.checked_in_at && session
    && now >= Date.parse(session.starts_at) - 30 * 60000 && now <= Date.parse(session.ends_at);
  const d = parseDay(b.session_date);
  return (
    <Card padding={18}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="overline" color={palette.ink2}>{t('home.nextClass')}</Text>
        {b.checked_in_at ? <Badge label={t('home.checkedIn')} tone="success" />
          : b.status === 'waitlisted' ? <Badge label={t('home.waitlisted', { pos: b.waitlist_position ?? '' })} tone="warning" />
            : <Badge label={t('home.booked')} tone="success" />}
      </View>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 56, height: 60, borderRadius: 12, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="caption" color={palette.ink2} style={{ textTransform: 'uppercase' }}>{weekdayShort(b.session_date)}</Text>
          <Text style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 26 }}>{d.getDate()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" style={{ fontSize: 16 }}>{b.title}</Text>
          <Text variant="small" color={palette.ink2}>{[`${hm(b.start_time)} – ${hm(b.end_time)}`, b.instructor_name, b.location].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      {!b.checked_in_at ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label={t('home.cancel')} variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
          {canCheckIn ? <Button label={t('home.checkIn')} variant="dark" onPress={onCheckIn} style={{ flex: 1 }} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Esta semana
// ---------------------------------------------------------------------------
function WeekClasses({ sessions, membership, busyId, onBook }: { sessions: Session[]; membership?: MyMembership; busyId: number | null; onBook: (s: Session) => void }) {
  const { accent } = useTheme();
  const upcoming = sessions.filter((s) => !s.is_past && s.status === 'scheduled');
  const used = sessions.filter((s) => s.my_booking && ['booked', 'attended'].includes(s.my_booking)).length;
  const list = upcoming.filter((s) => s.my_booking !== 'booked').slice(0, 6);
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title={t('home.thisWeek')} action={membership?.sessions_per_week
        ? <Text variant="small" color={palette.ink2}>{t('home.planUsage', { used, limit: membership.sessions_per_week })}</Text> : undefined} />
      <Card padding={0} style={{ gap: 0 }}>
        {list.length === 0 ? <Text color={palette.ink2} style={{ padding: space.md }}>{t('home.noMoreClasses')}</Text> : list.map((s, i) => {
          const full = s.spots_left === 0;
          const waiting = s.my_booking === 'waitlisted';
          return (
            <View key={s.id}>
              {i > 0 ? <Divider /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 }}>
                <Text variant="smallStrong" color={palette.ink2} style={{ width: 56, textTransform: 'capitalize' }}>{weekdayShort(s.session_date)} {parseDay(s.session_date).getDate()}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>{s.title}</Text>
                  <Text variant="caption" color={full ? palette.danger : palette.ink2}>
                    {hm(s.start_time)} · {full ? t('home.full') : s.spots_left == null ? '' : t('home.spotsLeft', { count: s.spots_left })}
                  </Text>
                </View>
                {waiting ? <Badge label={`#${s.my_waitlist_position ?? ''}`} tone="warning" />
                  : <Button label={full ? t('home.joinWaitlist') : t('home.book')} size="sm" variant={full ? 'secondary' : 'primary'}
                    loading={busyId === s.id} disabled={busyId !== null} onPress={() => onBook(s)}
                    style={full ? undefined : { backgroundColor: accent }} />}
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
export function StudentHome() {
  const { user, minors, actingUserId, setActingUser, hasRole } = useSession();
  const router = useRouter();
  const wide = useIsWide();
  const uid = actingUserId ?? user?.id ?? 0;

  // Un tutor que no entrena ve directamente a su primer menor
  useEffect(() => {
    if (!hasRole('student') && minors.length && uid === user?.id) setActingUser(minors[0].user_id);
  }, [minors, uid, user, hasRole, setActingUser]);

  const week = useMemo(thisWeek, []);
  const progress = useApi(() => studentHome.progress(uid), [uid]);
  const upcoming = useApi(() => studentHome.upcoming(uid), [uid]);
  const sessions = useApi(() => studentHome.sessions(uid, week.from, week.to), [uid]);
  const memberships = useApi(() => studentHome.memberships(uid), [uid]);
  const stats = useApi(() => studentHome.attendance(uid), [uid]);
  const charges = useApi(studentHome.charges);
  const news = useApi(studentHome.announcements);
  const unread = useApi(studentHome.unread);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [cancelOf, setCancelOf] = useState<{ b: Booking; s?: Session } | null>(null);
  const [checkInOf, setCheckInOf] = useState<Booking | null>(null);
  const [code, setCode] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const payMethods = useApi(studentHome.paymentMethods, [], { enabled: payOpen });
  const online = useApi(() => onlineApi.options(), [], { enabled: payOpen });

  const refreshClasses = () => { upcoming.reload(); sessions.reload(); stats.reload(); };
  const reloadAll = () => { refreshClasses(); progress.reload(); memberships.reload(); charges.reload(); news.reload(); unread.reload(); };

  const actingName = uid === user?.id ? user?.first_name : minors.find((m) => m.user_id === uid)?.first_name;
  const next = upcoming.data?.[0];
  const nextSession = next ? sessions.data?.data.find((s) => s.id === next.session_id) : undefined;
  const ms = memberships.data?.find((m) => ['active', 'past_due', 'paused', 'pending'].includes(m.status));
  const loading = progress.loading && !progress.data;

  async function book(s: Session) {
    setBusyId(s.id); setFlash(null);
    try {
      const r = await studentHome.book(s.id, uid);
      setFlash({ tone: r.status === 'booked' ? 'success' : 'info', text: r.status === 'booked' ? t('home.bookedOk') : t('home.waitlistOk') });
      refreshClasses();
    } catch (e) { setFlash({ tone: 'danger', text: errorMessage(e) }); } finally { setBusyId(null); }
  }
  async function confirmCancel() {
    if (!cancelOf) return;
    const { b } = cancelOf;
    setCancelOf(null); setBusyId(b.session_id);
    try { await studentHome.cancel(b.session_id, uid); refreshClasses(); } catch (e) { setFlash({ tone: 'danger', text: errorMessage(e) }); } finally { setBusyId(null); }
  }
  async function confirmCheckIn() {
    if (!checkInOf || code.trim().length !== 6) return;
    try {
      await studentHome.checkIn(checkInOf.session_id, uid, code.trim());
      setCheckInOf(null); setCode(''); setFlash({ tone: 'success', text: t('home.checkedIn') }); refreshClasses();
    } catch (e) { setFlash({ tone: 'danger', text: errorMessage(e) }); }
  }

  const bal = charges.data?.summary;
  const nextCharge = charges.data?.charges[0];
  const notice = news.data?.[0];

  return (
    <Screen maxWidth={wide ? 980 : 560} refreshing={upcoming.refreshing} onRefresh={reloadAll}>
      {/* Encabezado */}
      <View style={{ gap: space.md }}>
        {!wide ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <DojoMark size={36} />
            <IconButton icon="bell" label={t('nav.notifications')} badge={(unread.data ?? 0) > 0} onPress={() => router.push('/notifications')} />
          </View>
        ) : null}
        <ViewAs />
        <Text variant={wide ? 'display' : 'title'} accessibilityRole="header">{t('home.hello', { name: actingName ?? '' })}</Text>
      </View>

      {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}
      <PushNudge />
      {progress.error ? <Notice tone="danger">{progress.error}</Notice> : null}
      {loading ? <Loading /> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignItems: 'flex-start' }}>
          {/* Columna 1 */}
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 340, minWidth: 0, gap: space.md }}>
            {progress.data?.disciplines.length ? progress.data.disciplines.map((r) => <RankCard key={r.discipline_id} r={r} />) : (
              <Card dark><Text variant="heading" color="#FFFFFF">{t('home.noRankTitle')}</Text><Text variant="small" color="#D6D2C7">{t('home.noRankBody')}</Text></Card>
            )}
            {next ? (
              <NextClass b={next} session={nextSession} onCancel={() => setCancelOf({ b: next, s: nextSession })} onCheckIn={() => setCheckInOf(next)} />
            ) : (
              <Card padding={18}><Text variant="overline" color={palette.ink2}>{t('home.nextClass')}</Text><Text color={palette.ink2}>{t('home.noUpcoming')}</Text></Card>
            )}
            {sessions.data ? <WeekClasses sessions={sessions.data.data} membership={ms} busyId={busyId} onBook={book} /> : null}
          </View>

          {/* Columna 2 */}
          <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 300, minWidth: 0, gap: space.md }}>
            <Card padding={18}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
                <Text variant="bodyStrong">{ms ? ms.plan_name : t('home.noMembership')}</Text>
                {ms ? <Badge label={t(`home.status_${ms.status}`)} tone={ms.status === 'active' ? 'success' : ms.status === 'past_due' ? 'danger' : 'warning'} /> : null}
              </View>
              {ms ? (
                <>
                  <Text variant="small" color={palette.ink2}>
                    {ms.billing_type === 'class_pack' && ms.sessions_remaining != null ? t('home.classesLeft', { count: ms.sessions_remaining })
                      : ms.auto_renew && !ms.cancel_at_period_end && ms.next_billing_date ? t('home.renewsOn', { date: dayLong(ms.next_billing_date) })
                        : (ms.end_date || ms.current_period_end) ? t('home.endsOn', { date: dayLong((ms.end_date || ms.current_period_end)!) }) : ''}
                  </Text>
                  {ms.members.length > 1 ? <Text variant="caption" color={palette.ink2}>{t('home.includes', { names: ms.members.map((m) => m.first_name).join(', ') })}</Text> : null}
                </>
              ) : <Text variant="small" color={palette.ink2}>{t('home.noMembershipBody')}</Text>}

              {/* Pago: siempre de quien inició sesión (el tutor paga por sus menores) */}
              {bal ? (
                <>
                  <Divider />
                  {bal.balance_due > 0 ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: space.sm }}>
                      <View style={{ gap: 2, flex: 1 }}>
                        <Text variant="small" color={palette.ink2}>{nextCharge ? nextCharge.description : t('home.toPay')}</Text>
                        <Text variant="number" style={{ fontSize: 26, lineHeight: 32 }}>{money(bal.balance_due, nextCharge?.currency)}</Text>
                        {bal.overdue > 0 ? <Badge label={t('home.overdueBadge')} tone="danger" />
                          : bal.next_due_date ? <Text variant="caption" color={palette.ink2}>{t('home.dueIn', { date: dayShort(bal.next_due_date) })}</Text> : null}
                      </View>
                      <Button label={t('home.pay')} onPress={() => setPayOpen(true)} />
                    </View>
                  ) : <Text variant="smallStrong" color={palette.success}>{t('home.upToDate')}</Text>}
                </>
              ) : null}
            </Card>

            {stats.data ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Card padding={16} style={{ flex: 1, gap: 6 }}>
                  <Text variant="caption" color={palette.ink2}>{t('home.streak')}</Text>
                  <Text variant="title">{t('home.weeks', { count: stats.data.streak_weeks })}</Text>
                  <View accessibilityElementsHidden style={{ flexDirection: 'row', gap: 4 }}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <View key={i} style={{ flex: 1, height: 6, borderRadius: 2, backgroundColor: i < Math.min(6, stats.data!.streak_weeks) ? palette.ink : palette.sunken }} />
                    ))}
                  </View>
                </Card>
                <Card padding={16} style={{ flex: 1, gap: 6 }}>
                  <Text variant="caption" color={palette.ink2}>{t('home.attendance')}</Text>
                  <Text variant="title">{stats.data.attendance_rate == null ? '—' : `${stats.data.attendance_rate}%`}</Text>
                  <Text variant="caption" color={palette.ink2}>{t('home.last30')}</Text>
                </Card>
              </View>
            ) : null}

            {notice ? (
              <View style={{ backgroundColor: '#FBEAEA', borderRadius: 16, padding: 16, gap: 6 }}>
                <Text variant="overline" color="#7F1D1D">{t('home.dojoNotice')}</Text>
                <Text variant="bodyStrong">{notice.title}</Text>
                <Text variant="small" color={palette.ink2} numberOfLines={4}>{notice.body}</Text>
              </View>
            ) : null}
          </View>
        </View>
      )}

      {/* Diálogos */}
      <Dialog visible={!!cancelOf} title={t('home.cancelTitle')} onClose={() => setCancelOf(null)} actions={<>
        <Button label={t('home.keep')} variant="secondary" size="sm" onPress={() => setCancelOf(null)} />
        <Button label={t('home.yesCancel')} variant="danger" size="sm" onPress={confirmCancel} />
      </>}>
        {cancelOf ? <Text color={palette.ink2}>{cancelOf.b.title} · {dayLong(cancelOf.b.session_date)} {hm(cancelOf.b.start_time)}</Text> : null}
        {cancelOf?.s && cancelOf.b.status === 'booked' && !cancelOf.s.can_cancel_free
          ? <Notice tone="warning">{t('home.cancelLate', { hours: sessions.data?.meta.cancel_hours ?? '' })}</Notice>
          : <Text variant="small" color={palette.ink2}>{t('home.cancelFree')}</Text>}
      </Dialog>

      <Dialog visible={!!checkInOf} title={t('home.checkInTitle')} onClose={() => setCheckInOf(null)} actions={<>
        <Button label={t('common.cancel')} variant="secondary" size="sm" onPress={() => setCheckInOf(null)} />
        <Button label={t('home.checkIn')} variant="dark" size="sm" disabled={code.trim().length !== 6} onPress={confirmCheckIn} />
      </>}>
        <Text color={palette.ink2}>{t('home.checkInBody')}</Text>
        <Field label={t('home.code')} value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" maxLength={6} autoFocus />
      </Dialog>

      <Dialog visible={payOpen} title={t('home.payTitle')} onClose={() => setPayOpen(false)} actions={
        <Button label={t('common.close')} variant="dark" size="sm" onPress={() => setPayOpen(false)} />
      }>
        {payMethods.loading ? <Loading /> : payMethods.data ? (
          <View style={{ gap: space.sm }}>
            {payMethods.data.accepts_cash ? <Text>{t('home.payCash')}</Text> : null}
            {payMethods.data.accepts_transfer ? (
              <View style={{ gap: 4 }}>
                <Text variant="bodyStrong">{t('home.payTransfer')}</Text>
                {payMethods.data.transfer_instructions ? <Text selectable color={palette.ink2}>{payMethods.data.transfer_instructions}</Text> : null}
              </View>
            ) : null}
            {online.data?.length ? (
              <Button label={t('online.payOnline')} variant="dark" icon="credit-card" onPress={() => { setPayOpen(false); router.push('/payments'); }} />
            ) : null}
          </View>
        ) : null}
      </Dialog>
    </Screen>
  );
}

