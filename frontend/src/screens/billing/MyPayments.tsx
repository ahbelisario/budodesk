/** Estado de cuenta del alumno o tutor: saldo, membresías, pendientes, historial y cómo pagar */
import React from 'react';
import { View } from 'react-native';
import { billingApi } from '../../api/billing';
import { todayYmd } from '../../api/classes';
import { useSession } from '../../session/SessionProvider';
import { onlineApi } from '../../api/online';
import { PayOnline } from './PayOnline';
import { useApi } from '../../utils/useApi';
import { Screen } from '../../ui/Screen';
import { Card, Divider, EmptyState, Icon, Loading, Notice, SectionHeader, Text } from '../../ui/primitives';
import { palette, space, fonts } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayShort, dayShortTs, fullName, money } from '../../utils/format';
import { ChargeStatus, MsStatus, bt, dueLabel, planCycle } from './bits';

export function MyPayments() {
  useLanguage();
  const wide = useIsWide();
  const { user } = useSession();
  const today = todayYmd();
  const account = useApi(() => billingApi.myAccount(), []);
  const memberships = useApi(() => billingApi.myMemberships(), []);
  const payments = useApi(() => billingApi.myPayments(), []);
  const methods = useApi(() => billingApi.paymentMethods(), []);
  const online = useApi(() => onlineApi.options(), []);
  const reload = () => { account.reload(); memberships.reload(); payments.reload(); };

  if (account.loading || memberships.loading) return <Loading />;
  const s = account.data?.summary;
  const due = Number(s?.balance_due ?? 0);
  const overdue = Number(s?.overdue ?? 0);
  const credit = Number(s?.credit ?? 0);
  const open = (account.data?.charges ?? []).filter((c) => c.status === 'pending' || c.status === 'partial');
  const current = (memberships.data ?? []).filter((m) => ['active', 'past_due', 'paused', 'pending'].includes(m.status));
  const m = methods.data;

  return (
    <Screen maxWidth={1000} onRefresh={reload}>
      <Text variant="title" accessibilityRole="header">{bt('myPayments')}</Text>
      {account.error ? <Notice tone="danger">{account.error}</Notice> : null}

      {/* Saldo */}
      <Card style={{ gap: 6, borderLeftWidth: 5, borderLeftColor: overdue > 0 ? palette.danger : due > 0 ? palette.warning : palette.success }}>
        <Text variant="small" color={palette.ink2}>{bt('balanceDue')}</Text>
        <Text style={{ fontFamily: fonts.display, fontSize: 36, lineHeight: 42 }} color={overdue > 0 ? palette.danger : palette.ink}>{money(due)}</Text>
        {due === 0 ? <Text variant="bodyStrong" color={palette.success}>{bt('allPaid')}</Text> : null}
        {overdue > 0 ? <Text variant="bodyStrong" color={palette.danger}>{bt('overdueAmount', { amount: money(overdue) })}</Text> : null}
        {due > 0 && s?.next_due_date ? <Text variant="small" color={palette.ink2}>{bt('nextDue', { date: dayShort(s.next_due_date) })}</Text> : null}
        {credit > 0 ? <Text variant="small" color={palette.success}>{bt('credit', { amount: money(credit) })} · {bt('creditHint')}</Text> : null}
      </Card>

      <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.lg, alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 1.4 : undefined, alignSelf: 'stretch', gap: space.lg }}>
          {open.length && online.data?.length ? (
            <PayOnline options={online.data} charges={open.map((c) => ({
              id: c.id, description: c.description, balance: Number(c.balance), currency: c.currency, noteDanger: c.due_date < today,
              note: `${dueLabel(c.due_date, today, true)}${c.member_names && c.member_names !== user?.first_name ? ` · ${bt('forMembers', { names: c.member_names })}` : ''}`,
            }))} />
          ) : null}
          {open.length && !online.data?.length ? (
            <Card>
              <SectionHeader title={bt('pendingCharges')} />
              {open.map((c, i) => (
                <View key={c.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={2}>{c.description}</Text>
                      <Text variant="caption" color={c.due_date < today ? palette.danger : palette.ink2}>
                        {dueLabel(c.due_date, today, true)}{c.member_names && c.member_names !== user?.first_name ? ` · ${bt('forMembers', { names: c.member_names })}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text variant="bodyStrong">{money(c.balance, c.currency)}</Text>
                      <ChargeStatus status={c.status} due={c.due_date} today={today} />
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}

          <Card>
            <SectionHeader title={bt('myMemberships')} />
            {current.length === 0 ? <EmptyState icon="credit-card" title={bt('noMyMemberships')} body={bt('noMyMembershipsBody')} /> : current.map((ms, i) => (
              <View key={ms.id} style={{ gap: 4 }}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                  <Text variant="heading" style={{ flexShrink: 1 }}>{ms.plan_name}</Text>
                  <MsStatus status={ms.status} />
                </View>
                <Text variant="small" color={palette.ink2}>
                  {[`${money(ms.final_price, ms.currency)} · ${planCycle(ms)}`, ms.discount_reason].filter(Boolean).join(' · ')}
                </Text>
                {ms.members.length > 1 || ms.members[0]?.user_id !== user?.id ? (
                  <Text variant="small" color={palette.ink2}>{bt('forMembers', { names: ms.members.map((x) => fullName(x)).join(', ') })}</Text>
                ) : null}
                <Text variant="small" color={palette.ink2}>
                  {ms.cancel_at_period_end && ms.current_period_end ? bt('endsAtPeriod', { date: dayShort(ms.current_period_end) })
                    : ms.next_billing_date && ms.auto_renew ? bt('renews', { date: dayShort(ms.next_billing_date) })
                    : ms.current_period_end ? bt('until', { date: dayShort(ms.current_period_end) }) : ''}
                  {ms.sessions_remaining != null ? ` · ${bt('sessionsLeft', { count: ms.sessions_remaining })}` : ''}
                </Text>
              </View>
            ))}
          </Card>

          <Card>
            <SectionHeader title={bt('history')} />
            {payments.loading ? <Loading /> : (payments.data ?? []).length === 0 ? <Text color={palette.ink2}>{bt('noHistory')}</Text> : (payments.data ?? []).map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
                  <Icon name="check-circle" size={16} color={palette.success} />
                  <Text style={{ flex: 1 }}>{dayShortTs(p.paid_at)} · {t(`members.m_${p.method}`)}{p.reference ? ` · ${p.reference}` : ''}</Text>
                  <Text variant="bodyStrong">{money(p.amount, p.currency)}</Text>
                </View>
              </View>
            ))}
          </Card>
        </View>

        <Card style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch', gap: space.sm }}>
          <SectionHeader title={bt('howToPay')} />
          {!m || m.accepts_cash ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}><Icon name="dollar-sign" size={18} color={palette.ink2} /><Text style={{ flex: 1 }}>{bt('payCash')}</Text></View>
          ) : null}
          {m?.accepts_transfer ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Icon name="send" size={18} color={palette.ink2} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text>{bt('payTransfer')}</Text>
                {m.transfer_instructions ? <Text variant="small" color={palette.ink2} selectable>{m.transfer_instructions}</Text> : null}
              </View>
            </View>
          ) : null}
          {online.data?.length ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Icon name="globe" size={18} color={palette.ink2} />
              <Text style={{ flex: 1 }}>{online.data.map((o) => o.name).join(' · ')}</Text>
            </View>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}
