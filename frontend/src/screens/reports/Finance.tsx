/** Reportes de dinero (solo dueño/administrador): finanzas por mes y cuentas por cobrar */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { reportsApi, type FinanceMonth } from '../../api/reports';
import { useApi } from '../../utils/useApi';
import { Card, Divider, EmptyState, Loading, Notice, Text } from '../../ui/primitives';
import { FilterChips } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t } from '../../i18n';
import { dayShort, money } from '../../utils/format';
import { Tile } from '../billing/bits';
import { BarChart, ExportButton, Row, SERIES, Table, exportCsv, monthLabel, monthLong, monthPeriod, rt, type MonthPeriod } from './bits';

const METHOD_KEYS = ['cash', 'transfer', 'card', 'mercadopago', 'paypal', 'other'];

export function FinanceTab() {
  const wide = useIsWide();
  const [period, setPeriod] = useState<MonthPeriod>('last12');
  const [selected, setSelected] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const data = useApi(() => reportsApi.finance(monthPeriod(period)), [period]);
  const r = data.data;
  const cur = r?.currency ?? 'MXN';
  const catName = useMemo(() => Object.fromEntries((r?.categories ?? []).map((c) => [String(c.id), c.name])), [r]);
  const m: FinanceMonth | null = r ? (selected ? r.months.find((x) => x.month === selected) ?? null : null) : null;
  const scope = m ?? (r ? { ...r.totals, month: '' } as FinanceMonth : null);
  const empty = r && r.totals.income_total === 0 && r.totals.expense_total === 0;

  function doExport() {
    if (!r) return;
    const head = [rt('month'), rt('t_membership'), rt('t_exams'), rt('t_signup'), rt('t_other'), rt('t_credit'), rt('tuition'),
      ...r.categories.filter((c) => c.kind === 'income').map((c) => c.name), rt('otherIncome'), rt('income'),
      ...r.categories.filter((c) => c.kind === 'expense').map((c) => c.name), rt('onlineFees'), rt('expenses'), rt('net'), rt('cumulative')];
    const rows = r.months.map((x) => [x.month, x.tuition.membership, x.tuition.exams, x.tuition.signup, x.tuition.other, x.tuition.credit, x.tuition.total,
      ...r.categories.filter((c) => c.kind === 'income').map((c) => x.other_income[c.id] ?? 0), x.other_income_total, x.income_total,
      ...r.categories.filter((c) => c.kind === 'expense').map((c) => x.expenses[c.id] ?? 0), x.online_fees, x.expense_total, x.net, x.cumulative]);
    exportCsv(`finanzas_${r.from}_${r.to}`, head, rows);
  }

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <FilterChips label={rt('period')} value={period} onChange={(p) => { setPeriod(p); setSelected(null); }}
          options={(['last12', 'thisYear', 'lastYear'] as const).map((k) => ({ key: k, label: rt(k) }))} />
        {r && !empty ? <ExportButton onPress={doExport} /> : null}
      </View>
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}
      {data.loading && !r ? <Loading /> : r ? (
        <>
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
            <Tile label={rt('income')} value={money(r.totals.income_total, cur)} />
            <Tile label={rt('expenses')} value={money(r.totals.expense_total, cur)} />
            <Tile label={rt('net')} value={money(r.totals.net, cur)} tone={r.totals.net < 0 ? palette.danger : undefined} />
          </Card>

          {empty ? <Card><EmptyState icon="bar-chart-2" title={rt('noData')} body={rt('financeNote')} /></Card> : (
            <Card style={{ gap: space.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                <Text variant="bodyStrong">{rt('chartTitle')}</Text>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setTable((v) => !v)}>
                  <Text variant="small" color={palette.ink2} style={{ textDecorationLine: 'underline' }}>{table ? rt('chartView') : rt('tableView')}</Text>
                </Pressable>
              </View>
              {table ? (
                <ScrollView horizontal contentContainerStyle={{ minWidth: '100%' }}>
                  <View style={{ flexGrow: 1 }}>
                    <Table head={[rt('month'), rt('income'), rt('expenses'), rt('net'), rt('cumulative')]}
                      rows={r.months.map((x) => [monthLabel(x.month, true), money(x.income_total, cur), money(x.expense_total, cur), money(x.net, cur), money(x.cumulative, cur)])}
                      foot={['Total', money(r.totals.income_total, cur), money(r.totals.expense_total, cur), money(r.totals.net, cur), '']} />
                  </View>
                </ScrollView>
              ) : (
                <>
                  <BarChart currency={cur} selected={selected} onSelect={setSelected}
                    series={[{ name: rt('income'), color: SERIES.income }, { name: rt('expenses'), color: SERIES.expense }]}
                    points={r.months.map((x) => ({ key: x.month, label: monthLabel(x.month), values: [x.income_total, x.expense_total] }))} />
                  <Text variant="small" color={palette.ink2}>
                    {m ? `${monthLong(m.month)} · ${rt('income')} ${money(m.income_total, cur)} · ${rt('expenses')} ${money(m.expense_total, cur)} · ${rt('net')} ${money(m.net, cur)}` : rt('chartHint')}
                  </Text>
                </>
              )}
            </Card>
          )}

          {!empty && scope ? (
            <>
              {m ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Text variant="heading">{monthLong(m.month)}</Text>
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setSelected(null)}>
                    <Text variant="small" color={palette.ink2} style={{ textDecorationLine: 'underline' }}>{rt(period)}</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.md, alignItems: 'flex-start' }}>
                <Card style={{ flex: 1, alignSelf: 'stretch', gap: 0 }}>
                  <Text variant="bodyStrong" style={{ marginBottom: space.xs }}>{rt('incomeBreakdown')}</Text>
                  <Row label={rt('tuition')} value={money(scope.tuition.total, cur)} strong swatch={SERIES.income} />
                  {(['membership', 'exams', 'signup', 'other', 'credit'] as const).filter((k) => scope.tuition[k]).map((k) => (
                    <Row key={k} indent muted label={rt(`t_${k}`)} value={money(scope.tuition[k], cur)} />
                  ))}
                  <Divider />
                  <Row label={rt('otherIncome')} value={money(scope.other_income_total, cur)} strong swatch={SERIES.income} />
                  {Object.entries(scope.other_income).sort((a, b) => b[1] - a[1]).map(([id, v]) => (
                    <Row key={id} indent muted label={catName[id] ?? '—'} value={money(v, cur)} />
                  ))}
                  <Divider />
                  <Row label={rt('income')} value={money(scope.income_total, cur)} strong />
                </Card>
                <Card style={{ flex: 1, alignSelf: 'stretch', gap: 0 }}>
                  <Text variant="bodyStrong" style={{ marginBottom: space.xs }}>{rt('expenseBreakdown')}</Text>
                  {Object.entries(scope.expenses).sort((a, b) => b[1] - a[1]).map(([id, v]) => (
                    <Row key={id} label={catName[id] ?? '—'} value={money(v, cur)} swatch={SERIES.expense} />
                  ))}
                  {scope.online_fees ? <Row label={rt('onlineFees')} value={money(scope.online_fees, cur)} swatch={SERIES.expense} /> : null}
                  {!Object.keys(scope.expenses).length && !scope.online_fees ? <Text variant="small" color={palette.ink2}>—</Text> : null}
                  <Divider />
                  <Row label={rt('expenses')} value={money(scope.expense_total, cur)} strong />
                  <Row label={rt('net')} value={money(scope.net, cur)} strong />
                </Card>
              </View>
              {Object.keys(scope.methods).length ? (
                <Card style={{ gap: 0 }}>
                  <Text variant="bodyStrong" style={{ marginBottom: space.xs }}>{rt('byMethod')}</Text>
                  {METHOD_KEYS.filter((k) => scope.methods[k]).map((k) => (
                    <Row key={k} label={t(`members.m_${k}`)} value={money(scope.methods[k], cur)} />
                  ))}
                </Card>
              ) : null}
            </>
          ) : null}
          <Text variant="caption" color={palette.ink2}>{rt('financeNote')}</Text>
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
export function ReceivablesTab() {
  const router = useRouter();
  const data = useApi(() => reportsApi.receivables(), []);
  const r = data.data;
  const cur = r?.currency ?? 'MXN';
  const buckets = [['d1_30', 'b_1_30'], ['d31_60', 'b_31_60'], ['d61_90', 'b_61_90'], ['d90', 'b_90']] as const;

  function doExport() {
    if (!r) return;
    exportCsv(`por_cobrar_${r.today}`, ['Nombre', rt('owed'), rt('b_current'), rt('b_1_30'), rt('b_31_60'), rt('b_61_90'), rt('b_90'), rt('date')],
      r.rows.map((x) => [x.name, x.total, x.current, x.d1_30, x.d31_60, x.d61_90, x.d90, x.oldest_due]));
  }

  if (data.loading && !r) return <Loading />;
  if (data.error) return <Notice tone="danger">{data.error}</Notice>;
  if (!r) return null;
  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
          <Tile label={rt('owed')} value={money(r.totals.total, cur)} hint={rt('people', { count: r.people })} />
          <Tile label={rt('overdue')} value={money(r.totals.overdue, cur)} tone={r.totals.overdue > 0 ? palette.danger : undefined} />
          <Tile label={rt('notDue')} value={money(r.totals.current, cur)} />
        </View>
        {r.totals.overdue > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {buckets.map(([k, label]) => (
              <View key={k} style={{ flexGrow: 1, flexBasis: 120, gap: 2 }}>
                <Text variant="caption" color={palette.ink2}>{rt(label)}</Text>
                <Text variant="bodyStrong">{money(r.totals[k], cur)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
      {r.rows.length ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><ExportButton onPress={doExport} /></View>
      ) : null}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {r.rows.length === 0 ? <EmptyState icon="check-circle" title={rt('nobodyOwes')} body={rt('nobodyOwesBody')} /> : r.rows.map((x, i) => (
          <View key={x.user_id}>
            {i > 0 ? <Divider /> : null}
            <Pressable accessibilityRole="link" onPress={() => router.push(`/members/${x.user_id}?tab=billing` as never)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md }}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1}>{x.name}</Text>
                <Text variant="caption" color={palette.ink2} numberOfLines={2}>
                  {[rt('chargesN', { count: x.charges }), rt('oldest', { date: dayShort(x.oldest_due) }),
                    ...buckets.filter(([k]) => x[k] > 0).map(([k, label]) => `${rt(label)}: ${money(x[k], cur)}`)].join(' · ')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text variant="bodyStrong">{money(x.total, cur)}</Text>
                {x.overdue > 0 ? <Text variant="caption" color={palette.danger}>{rt('overdue')} {money(x.overdue, cur)}</Text>
                  : <Text variant="caption" color={palette.ink2}>{rt('notDue')}</Text>}
              </View>
            </Pressable>
          </View>
        ))}
      </Card>
    </View>
  );
}
