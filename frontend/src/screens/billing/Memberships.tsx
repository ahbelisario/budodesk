/** Membresías (personal): lista con filtros + pestañas de Planes y Descuentos */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { billingApi, type MembershipRow } from '../../api/billing';
import { useApi } from '../../utils/useApi';
import { Screen } from '../../ui/Screen';
import { Button, Card, Divider, EmptyState, Loading, Notice, Text } from '../../ui/primitives';
import { FilterChips, SearchField, Tabs } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayShort, money } from '../../utils/format';
import { applyDiscount } from '../../api/billing';
import { MsStatus, bt } from './bits';
import { DiscountsTab, PlansTab } from './CatalogTabs';

type Filter = 'current' | 'past_due' | 'expiring' | 'cancelled' | 'expired' | 'all';

function Row({ m, wide, onPress }: { m: MembershipRow; wide: boolean; onPress: () => void }) {
  const final = applyDiscount(Number(m.price), m.discount_type, m.discount_value);
  const when = m.cancel_at_period_end && m.current_period_end ? bt('endsAtPeriod', { date: dayShort(m.current_period_end) })
    : m.next_billing_date && m.auto_renew ? bt('renews', { date: dayShort(m.next_billing_date) })
    : m.end_date ?? m.current_period_end ? bt('until', { date: dayShort((m.end_date ?? m.current_period_end)!) }) : '';
  const owes = Number(m.balance_due) > 0;
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={({ pressed }) => ({ padding: space.md, backgroundColor: pressed ? palette.paper : 'transparent' })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: wide ? 2.2 : 1, minWidth: 0, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={2}>{m.members ?? '—'}</Text>
          <Text variant="small" color={palette.ink2} numberOfLines={1}>{m.plan_name}{!wide ? ` · ${money(final, m.currency)}` : ''}</Text>
          {!wide ? <Text variant="caption" color={owes ? palette.danger : palette.ink2}>{owes ? bt('owes', { amount: money(m.balance_due, m.currency) }) : when}</Text> : null}
        </View>
        {wide ? (
          <>
            <Text variant="body" style={{ flex: 1 }}>{money(final, m.currency)}</Text>
            <Text variant="small" color={palette.ink2} style={{ flex: 1.4 }} numberOfLines={1}>{when}</Text>
            <Text variant="smallStrong" color={owes ? palette.danger : palette.ink3} style={{ flex: 1 }}>{owes ? money(m.balance_due, m.currency) : '—'}</Text>
          </>
        ) : null}
        <MsStatus status={m.status} />
      </View>
    </Pressable>
  );
}

function MembershipList() {
  const router = useRouter();
  const wide = useIsWide();
  const [filter, setFilter] = useState<Filter>('current');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<MembershipRow[]>([]);
  useEffect(() => { const h = setTimeout(() => setDq(q), 300); return () => clearTimeout(h); }, [q]);
  const data = useApi(() => billingApi.memberships({
    status: filter === 'expiring' ? 'current' : filter, expiring_days: filter === 'expiring' ? 15 : undefined, q: dq || undefined, page, page_size: 30,
  }), [filter, dq, page]);
  useEffect(() => { setPage(1); }, [filter, dq]);
  useEffect(() => { if (data.data) setRows((prev) => (page === 1 ? data.data!.data : [...prev, ...data.data!.data])); }, [data.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = data.data?.meta?.total ?? rows.length;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchField value={q} onChange={setQ} placeholder={bt('search')} />
        <Button label={bt('newMembership')} icon="plus" onPress={() => router.push('/memberships/new' as never)} />
      </View>
      <FilterChips label={bt('memberships')} value={filter} onChange={setFilter}
        options={(['current', 'past_due', 'expiring', 'cancelled', 'expired', 'all'] as const).map((k) => ({ key: k, label: bt(`f_${k}`) }))} />
      {data.error ? <Notice tone="danger">{data.error}</Notice> : null}
      {!data.loading || rows.length ? <Text variant="small" color={palette.ink2}>{bt('count', { count: total })}</Text> : null}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {data.loading && page === 1 ? <Loading /> : rows.length === 0 ? (
          <EmptyState icon="credit-card" title={bt('noMemberships')} body={bt('noMembershipsBody')} />
        ) : rows.map((m, i) => (
          <View key={m.id}>{i > 0 ? <Divider /> : null}<Row m={m} wide={wide} onPress={() => router.push(`/memberships/${m.id}` as never)} /></View>
        ))}
      </Card>
      {rows.length < total ? <Button label={t('members.loadMore')} variant="secondary" loading={data.loading} onPress={() => setPage(page + 1)} style={{ alignSelf: 'center' }} /> : null}
    </View>
  );
}

export function Memberships() {
  useLanguage();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'memberships' | 'plans' | 'discounts'>((params.tab as never) || 'memberships');
  return (
    <Screen maxWidth={1200}>
      <Text variant="title" accessibilityRole="header">{bt('memberships')}</Text>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'memberships', label: bt('tab_memberships') }, { key: 'plans', label: bt('tab_plans') }, { key: 'discounts', label: bt('tab_discounts') },
      ]} />
      {tab === 'memberships' ? <MembershipList /> : tab === 'plans' ? <PlansTab /> : <DiscountsTab />}
    </Screen>
  );
}
