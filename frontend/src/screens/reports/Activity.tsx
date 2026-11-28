/** Reportes para el personal: alumnos, asistencia y grados */
import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { reportsApi } from '../../api/reports';
import { useApi } from '../../utils/useApi';
import { Card, Divider, EmptyState, Loading, Notice, ProgressBar, Text } from '../../ui/primitives';
import { FilterChips } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { dayShort } from '../../utils/format';
import { Tile } from '../billing/bits';
import { ExportButton, Table, dayPeriod, exportCsv, monthLabel, monthPeriod, rt, type DayPeriod, type MonthPeriod } from './bits';

// ---------------------------------------------------------------------------
export function MembersTab() {
  const [period, setPeriod] = useState<MonthPeriod>('last12');
  const data = useApi(() => reportsApi.members(monthPeriod(period)), [period]);
  const r = data.data;
  return (
    <View style={{ gap: space.md }}>
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}
      {data.loading && !r ? <Loading /> : r ? (
        <>
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            <Tile label={rt('activeStudents')} value={String(r.snapshot.active)} />
            <Tile label={rt('minors')} value={String(r.snapshot.minors)} />
            <Tile label={rt('withAccess')} value={String(r.snapshot.with_access)} />
            <Tile label={rt('inactiveStudents')} value={String(r.snapshot.inactive)} />
          </Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <FilterChips label={rt('period')} value={period} onChange={setPeriod}
              options={(['last12', 'thisYear', 'lastYear'] as const).map((k) => ({ key: k, label: rt(k) }))} />
            <ExportButton onPress={() => exportCsv(`alumnos_${r.from}_${r.to}`, [rt('month'), rt('joined'), rt('left'), rt('paidMonth'), rt('unpaidMonth')],
              r.months.map((m) => [m.month, m.joined, m.left, m.paid, m.unpaid]))} />
          </View>
          <Card>
            <ScrollView horizontal contentContainerStyle={{ minWidth: '100%' }}>
              <View style={{ flexGrow: 1 }}>
                <Table minColWidth={72} head={[rt('month'), rt('joined'), rt('left'), rt('paidMonth'), rt('unpaidMonth')]}
                  rows={[...r.months].reverse().map((m) => [monthLabel(m.month, true), m.joined || '—', m.left || '—', m.paid || '—', m.unpaid || '—'])} />
              </View>
            </ScrollView>
          </Card>
          <Text variant="caption" color={palette.ink2}>{rt('membersNote')}</Text>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
export function AttendanceTab() {
  const router = useRouter();
  const wide = useIsWide();
  const [period, setPeriod] = useState<DayPeriod>('last30');
  const data = useApi(() => reportsApi.attendance(dayPeriod(period)), [period]);
  const r = data.data;
  const maxAtt = Math.max(1, ...(r?.students ?? []).map((s) => s.attended));
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <FilterChips label={rt('period')} value={period} onChange={setPeriod}
          options={(['last30', 'thisMonth', 'lastMonth', 'last90'] as const).map((k) => ({ key: k, label: rt(k) }))} />
        {r?.students.length ? (
          <ExportButton onPress={() => exportCsv(`asistencia_${r.from}_${r.to}`, ['Nombre', rt('attendances'), 'No show', rt('date')],
            r.students.map((s) => [s.name, s.attended, s.no_show, s.last_attended]))} />
        ) : null}
      </View>
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}
      {data.loading && !r ? <Loading /> : r ? (
        <>
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            <Tile label={rt('sessions')} value={String(r.totals.sessions)} />
            <Tile label={rt('attendances')} value={String(r.totals.attended)} />
            <Tile label={rt('avgPerClass')} value={String(r.totals.avg)} />
            <Tile label={rt('withoutAttendance')} value={String(r.totals.students_without)} tone={r.totals.students_without ? palette.warning : undefined} />
          </Card>
          {r.instructors?.length ? (
            <Card style={{ gap: space.xs }}>
              <Text variant="bodyStrong">{rt('byInstructor')}</Text>
              <Text variant="small" color={palette.ink2}>{rt('byInstructorHint')}</Text>
              {r.instructors.map((x, i) => (
                <View key={x.user_id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${x.user_id}` as never)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>{x.name}</Text>
                      <Text variant="caption" color={palette.ink2}>
                        {[rt('studentsTaught', { count: x.attended }), x.as_substitute ? rt('asSubstitute', { count: x.as_substitute }) : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="bodyStrong">{x.sessions}</Text>
                      <Text variant="caption" color={palette.ink2}>{rt('classesTaught', { count: x.sessions })}</Text>
                    </View>
                  </Pressable>
                </View>
              ))}
            </Card>
          ) : null}
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.md, alignItems: 'flex-start' }}>
            <Card style={{ flex: 1, alignSelf: 'stretch', gap: space.xs }}>
              <Text variant="bodyStrong">{rt('byClass')}</Text>
              {r.classes.length === 0 ? <Text variant="small" color={palette.ink2}>{rt('noClasses')}</Text> : r.classes.map((c, i) => (
                <View key={c.k}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>{c.title}</Text>
                      <Text variant="caption" color={palette.ink2}>{[c.discipline, `${c.sessions} ${rt('sessions').toLowerCase()}`, rt('noShowN', { count: c.no_show })].filter(Boolean).join(' · ')}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="bodyStrong">{c.avg}</Text>
                      <Text variant="caption" color={palette.ink2}>{rt('attendedN', { count: c.attended })}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </Card>
            <Card style={{ flex: 1.3, alignSelf: 'stretch', gap: space.xs }}>
              <Text variant="bodyStrong">{rt('byStudent')}</Text>
              {r.students.map((s, i) => (
                <View key={s.user_id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${s.user_id}` as never)} style={{ gap: 6, paddingVertical: space.xs }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{s.name}</Text>
                      <Text variant="bodyStrong" color={s.attended ? palette.ink : palette.warning}>{s.attended}</Text>
                    </View>
                    <ProgressBar value={s.attended / maxAtt} />
                    <Text variant="caption" color={palette.ink2}>
                      {s.last_attended ? rt('lastAttended', { date: dayShort(s.last_attended) }) : rt('neverAttended')}
                      {s.no_show ? ` · ${rt('noShowN', { count: s.no_show })}` : ''}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Card>
          </View>
          <Text variant="caption" color={palette.ink2}>{rt('attendanceNote')}</Text>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
type YearPeriod = 'thisYear' | 'lastYear';
const yearRange = (p: YearPeriod) => {
  const y = new Date().getFullYear() - (p === 'lastYear' ? 1 : 0);
  return p === 'thisYear' ? { from: `${y}-01-01` } : { from: `${y}-01-01`, to: `${y}-12-31` };
};

export function RanksReportTab() {
  const router = useRouter();
  const wide = useIsWide();
  const [period, setPeriod] = useState<YearPeriod>('thisYear');
  const data = useApi(() => reportsApi.ranks(yearRange(period)), [period]);
  const r = data.data;
  const byDisc = (r?.distribution ?? []).reduce<Record<string, NonNullable<typeof r>['distribution']>>((acc, x) => {
    (acc[x.discipline] ||= []).push(x); return acc;
  }, {});
  const maxN = Math.max(1, ...(r?.distribution ?? []).map((x) => x.members));
  return (
    <View style={{ gap: space.md }}>
      <FilterChips label={rt('period')} value={period} onChange={setPeriod}
        options={(['thisYear', 'lastYear'] as const).map((k) => ({ key: k, label: rt(k) }))} />
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}
      {data.loading && !r ? <Loading /> : r ? (
        <>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.md, alignItems: 'flex-start' }}>
            <Card style={{ flex: 1, alignSelf: 'stretch', gap: space.xs }}>
              <Text variant="bodyStrong">{rt('examsTitle')}</Text>
              {r.exams.length === 0 ? <Text variant="small" color={palette.ink2}>{rt('noExams')}</Text> : r.exams.map((e, i) => (
                <View key={e.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable accessibilityRole="link" onPress={() => router.push(`/ranks/exams/${e.id}` as never)} style={{ paddingVertical: space.xs, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>{e.title}</Text>
                    <Text variant="caption" color={palette.ink2}>
                      {[dayShort(e.exam_date), e.discipline, `${rt('candidates')}: ${e.candidates}`, `${rt('passed')}: ${e.passed}`,
                        e.failed ? `${rt('failed')}: ${e.failed}` : null, e.absent ? `${rt('absent')}: ${e.absent}` : null].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Card>
            <Card style={{ flex: 1, alignSelf: 'stretch', gap: space.xs }}>
              <Text variant="bodyStrong">{rt('promotionsTitle')}</Text>
              {r.promotions.length === 0 ? <Text variant="small" color={palette.ink2}>{rt('noPromotions')}</Text> : r.promotions.map((p, i) => (
                <View key={`${p.user_id}-${p.awarded_date}-${i}`}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ flexDirection: 'row', gap: space.sm, paddingVertical: space.xs, alignItems: 'center' }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>{p.name}</Text>
                      <Text variant="caption" color={palette.ink2}>{p.rank_name} · {p.discipline}</Text>
                    </View>
                    <Text variant="small" color={palette.ink2}>{dayShort(p.awarded_date)}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
          <Card style={{ gap: space.sm }}>
            <Text variant="bodyStrong">{rt('distributionTitle')}</Text>
            {Object.keys(byDisc).length === 0 ? <EmptyState icon="award" title={rt('noRanks')} /> : Object.entries(byDisc).map(([disc, list]) => (
              <View key={disc} style={{ gap: space.xs }}>
                {Object.keys(byDisc).length > 1 ? <Text variant="overline" color={palette.ink2}>{disc}</Text> : null}
                {list.map((x) => (
                  <View key={x.rank_id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Text variant="small" style={{ width: 96 }} numberOfLines={1}>{x.rank_name}</Text>
                    <View style={{ flex: 1 }}><ProgressBar value={x.members / maxN} /></View>
                    <Text variant="small" color={palette.ink2} style={{ width: 84, textAlign: 'right' }}>{rt('studentsN', { count: x.members })}</Text>
                  </View>
                ))}
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </View>
  );
}
