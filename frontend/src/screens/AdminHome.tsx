/**
 * Inicio del administrador / staff / instructor.
 * Todo se calcula en el servidor (/dashboard/*). El instructor no ve finanzas.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '../session/SessionProvider';
import { adminHome, type DashboardSummary, type DashboardTodo, type Revenue } from '../api/home';
import { useApi } from '../utils/useApi';
import { Screen } from '../ui/Screen';
import { Button, Card, Divider, Loading, Notice, ProgressBar, SectionHeader, Text } from '../ui/primitives';
import { palette, space, fonts } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { useIsWide } from '../navigation/AppShell';
import { t, getLanguage } from '../i18n';
import { capitalize, dayLong, dayShort, fullName, greeting, hm, money, parseDay } from '../utils/format';

const monthName = (ym: string, style: 'long' | 'short' = 'long') =>
  new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'es-MX', { month: style }).format(parseDay(`${ym}-01`));

function Kpi({ label, value, foot, tone, bar }: { label: string; value: string; foot?: string; tone?: 'good' | 'bad'; bar?: number }) {
  const wide = useIsWide();
  return (
    <Card style={{ flexGrow: 1, flexShrink: 1, flexBasis: wide ? 210 : 140, minWidth: 0 }} padding={wide ? 20 : 16}>
      <Text variant="small" color={palette.ink2}>{label}</Text>
      <Text variant="number" style={wide ? undefined : { fontSize: 24, lineHeight: 30 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {bar != null ? <ProgressBar value={bar} label={label} /> : null}
      {foot ? <Text variant="small" color={tone === 'good' ? palette.success : tone === 'bad' ? palette.danger : palette.ink2}
        style={{ fontFamily: tone ? fonts.bodyMedium : fonts.body }}>{foot}</Text> : null}
    </Card>
  );
}

function TodayClasses({ s }: { s: DashboardSummary }) {
  const router = useRouter();
  const { accent } = useTheme();
  const wide = useIsWide();
  return (
    <Card>
      <SectionHeader title={t('home.today')} action={
        <Pressable accessibilityRole="link" onPress={() => router.push('/classes')}><Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{t('home.viewSchedule')}</Text></Pressable>
      } />
      {s.today_classes.length === 0 ? <Text color={palette.ink2}>{t('home.noClassesToday')}</Text> : s.today_classes.map((c, i) => {
        const full = c.capacity != null && c.booked_count >= c.capacity;
        const ratio = c.capacity ? c.booked_count / c.capacity : 0;
        return (
          <View key={c.id}>
            {i > 0 ? <Divider /> : null}
            <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: wide ? space.md : space.xs, paddingVertical: space.sm }}>
              <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', flex: wide ? 1 : undefined }}>
                <Text variant="bodyStrong" color={palette.ink2} style={{ width: 52 }}>{hm(c.start_time)}</Text>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{c.title}</Text>
                  {c.instructor_name ? <Text variant="small" color={palette.ink2}>{c.instructor_name}</Text> : null}
                </View>
              </View>
              <View style={{ width: wide ? 170 : undefined, gap: 6, paddingLeft: wide ? 0 : 68 }}>
                <Text variant="small" color={full ? palette.danger : palette.ink2} style={{ fontFamily: full ? fonts.bodyMedium : fonts.body }}>
                  {c.capacity == null ? t('home.spotsNoLimit', { booked: c.booked_count })
                    : full ? t('home.full') : t('home.spots', { booked: c.booked_count, capacity: c.capacity })}
                </Text>
                {c.capacity != null ? <ProgressBar value={ratio} color={full ? accent : palette.ink} /> : null}
              </View>
              <View style={{ paddingLeft: wide ? 0 : 68 }}>
                <Button label={t('home.takeAttendance')} size="sm" variant="secondary" onPress={() => router.push(`/classes?session=${c.id}` as any)} />
              </View>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function RevenueChart({ revenue, currency }: { revenue: Revenue; currency: string }) {
  const { accent } = useTheme();
  const max = Math.max(1, ...revenue.months.map((m) => m.total));
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));
  return (
    <Card>
      <SectionHeader title={t('home.revenueByMonth')} action={<Text variant="small" color={palette.ink2}>{t('home.last6')} · {currency}</Text>} />
      <View accessibilityRole="image" accessibilityLabel={revenue.months.map((m) => `${monthName(m.month)}: ${money(m.total, currency)}`).join(', ')}
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, height: 180, marginTop: space.xs }}>
        {revenue.months.map((m, i) => {
          const last = i === revenue.months.length - 1;
          return (
            <View key={m.month} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}>
              <Text variant="caption" color={last ? palette.ink : palette.ink2}>{fmt(m.total)}</Text>
              <View style={{ width: '100%', maxWidth: 56, height: Math.max(4, (m.total / max) * 140), borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: last ? accent : '#D9D4C8' }} />
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {revenue.months.map((m, i) => (
          <Text key={m.month} variant="caption" align="center" color={i === revenue.months.length - 1 ? palette.ink : palette.ink2} style={{ flex: 1 }}>
            {monthName(m.month, 'short').replace('.', '')}
          </Text>
        ))}
      </View>
    </Card>
  );
}

type TodoItem = { key: string; dot: string; title: string; body?: string; action: string; href: string };

function names(list: { first_name: string; last_name: string | null }[], max = 3) {
  const shown = list.slice(0, max).map((p) => fullName(p)).join(', ');
  return list.length > max ? `${shown} ${t('home.more', { count: list.length - max })}` : shown;
}

function TodoCard({ todo, summary }: { todo: DashboardTodo; summary: DashboardSummary }) {
  const router = useRouter();
  const items: TodoItem[] = [];
  if (todo.overdue.length) items.push({
    key: 'overdue', dot: palette.danger,
    title: t('home.todoOverdue', { count: todo.overdue.length }),
    body: names(todo.overdue), action: t('home.review'), href: '/billing',
  });
  if (todo.pending_members.length) items.push({
    key: 'pending', dot: '#B45309', title: t('home.todoPending', { count: todo.pending_members.length }),
    body: names(todo.pending_members), action: t('home.review'), href: '/members?status=pending',
  });
  if (summary.exam_eligible) items.push({
    key: 'eligible', dot: palette.info, title: t('home.todoEligible', { count: summary.exam_eligible }),
    body: t('home.todoEligibleBody'), action: t('home.seeList'), href: '/ranks',
  });
  if (todo.at_risk.length) items.push({
    key: 'risk', dot: palette.ink3, title: t('home.todoAtRisk', { count: todo.at_risk.length, days: summary.at_risk_days }),
    body: names(todo.at_risk), action: t('home.seeList'), href: '/members',
  });
  if (todo.expiring.length) items.push({
    key: 'expiring', dot: palette.ink3, title: t('home.todoExpiring', { count: todo.expiring.length }),
    body: t('home.todoExpiringBody'), action: t('home.review'), href: '/memberships',
  });
  if (todo.birthdays.length) items.push({
    key: 'bday', dot: '#C026D3', title: t('home.todoBirthdays'),
    body: todo.birthdays.map((b) => `${fullName(b)} (${dayShort(b.date_of_birth.replace(/^\d{4}/, summary.today.slice(0, 4)))})`).join(', '),
    action: t('home.seeList'), href: '/members',
  });

  return (
    <Card>
      <SectionHeader title={t('home.todo')} />
      {items.length === 0 ? <Text color={palette.ink2}>{t('home.allClear')}</Text> : items.map((it, i) => (
        <View key={it.key}>
          {i > 0 ? <Divider /> : null}
          <View style={{ flexDirection: 'row', gap: space.sm, paddingVertical: space.sm }}>
            <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: it.dot, marginTop: 5 }} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="bodyStrong">{it.title}</Text>
              {it.body ? <Text variant="small" color={palette.ink2}>{it.body}</Text> : null}
              <Pressable accessibilityRole="link" onPress={() => router.push(it.href as any)} hitSlop={6}>
                <Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{it.action}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ))}
    </Card>
  );
}

function NextExam({ s }: { s: DashboardSummary }) {
  const router = useRouter();
  const exam = s.upcoming_exams[0];
  if (!exam) return null;
  return (
    <Card dark>
      <Text variant="overline" color={palette.mutedOnDark}>{t('home.nextExam')}</Text>
      <Text variant="heading" color="#FFFFFF">{exam.title}</Text>
      <Text variant="small" color="#D6D2C7">{exam.discipline} · {dayLong(exam.exam_date)} · {t('home.candidates', { count: exam.candidates })}</Text>
      <Pressable accessibilityRole="link" onPress={() => router.push(`/ranks?exam=${exam.id}` as any)}>
        <Text variant="smallStrong" color="#FFFFFF" style={{ textDecorationLine: 'underline' }}>{t('home.seeCandidates')}</Text>
      </Pressable>
    </Card>
  );
}

export function AdminHome() {
  const { user, hasRole } = useSession();
  const router = useRouter();
  const wide = useIsWide();
  const summary = useApi(adminHome.summary);
  const todo = useApi(adminHome.todo);
  const financial = hasRole('owner', 'admin', 'staff');
  const revenue = useApi(adminHome.revenue, [], { enabled: financial });

  const s = summary.data;
  const refreshing = summary.refreshing || todo.refreshing;
  const reload = () => { summary.reload(); todo.reload(); if (financial) revenue.reload(); };

  const kpis: React.ReactNode[] = [];
  if (s?.finance) {
    const f = s.finance;
    const prev = f.revenue.last_month_to_date;
    const pct = prev > 0 ? Math.round(((f.revenue.this_month - prev) / prev) * 100) : null;
    const thisMonth = monthName(s.today.slice(0, 7));
    const prevMonthDate = parseDay(`${s.today.slice(0, 7)}-01`); prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonth = new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'es-MX', { month: 'long' }).format(prevMonthDate);
    kpis.push(<Kpi key="rev" label={t('home.revenueMonth', { month: thisMonth })} value={money(f.revenue.this_month, f.currency)}
      foot={pct == null ? undefined : `${pct >= 0 ? '▲' : '▼'} ${t('home.vsLastMonth', { pct: Math.abs(pct), month: prevMonth })}`}
      tone={pct == null ? undefined : pct >= 0 ? 'good' : 'bad'} />);
    kpis.push(<Kpi key="rec" label={t('home.receivable')} value={money(f.receivables.open_balance, f.currency)}
      foot={f.receivables.overdue_balance > 0 ? t('home.overdueOf', { amount: money(f.receivables.overdue_balance, f.currency), count: f.receivables.overdue_people }) : t('home.nothingOverdue')}
      tone={f.receivables.overdue_balance > 0 ? 'bad' : undefined} />);
  }
  if (s) {
    kpis.push(<Kpi key="mem" label={t('home.activeMembers')} value={String(s.members.active)}
      foot={t('home.newAndPending', { new: s.members.new_this_month, pending: s.members.pending_approval })} />);
    kpis.push(<Kpi key="att" label={t('home.attendance30')} value={s.attendance_30d.rate == null ? '—' : `${s.attendance_30d.rate}%`}
      bar={s.attendance_30d.rate == null ? undefined : s.attendance_30d.rate / 100}
      foot={t('home.attendanceDetail', { attended: s.attendance_30d.attended, noShow: s.attendance_30d.no_show })} />);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ gap: 4 }}>
          {s ? <Text variant="small" color={palette.ink2}>{capitalize(dayLong(s.today))}</Text> : null}
          <Text variant={wide ? 'display' : 'title'} accessibilityRole="header">{greeting()}, {user?.first_name}</Text>
        </View>
        {financial ? (
          <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
            <Button label={t('home.registerPayment')} variant="secondary" icon="dollar-sign" onPress={() => router.push('/billing?new=payment' as any)} />
            <Button label={t('home.newMember')} icon="user-plus" onPress={() => router.push('/members?new=1' as any)} />
          </View>
        ) : null}
      </View>

      {summary.error ? <Notice tone="danger" title={t('errors.generic')}>{summary.error}</Notice> : null}
      {summary.loading && !s ? <Loading /> : null}

      {s ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>{kpis}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, alignItems: 'flex-start' }}>
            <View style={{ flexGrow: 999, flexShrink: 1, flexBasis: 480, minWidth: 0, gap: space.lg }}>
              <TodayClasses s={s} />
              {financial && revenue.data && s.finance ? <RevenueChart revenue={revenue.data} currency={s.finance.currency} /> : null}
            </View>
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 320, minWidth: 0, gap: space.lg }}>
              {todo.data ? <TodoCard todo={todo.data} summary={s} /> : todo.loading ? <Card><Loading /></Card> : null}
              <NextExam s={s} />
            </View>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

