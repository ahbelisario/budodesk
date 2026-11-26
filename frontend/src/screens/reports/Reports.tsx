/** Reportes: el dinero (finanzas, por cobrar, gastos e ingresos) solo para dueño/admin; lo demás para el personal */
import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../session/SessionProvider';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/primitives';
import { Tabs } from '../../ui/forms';
import { useLanguage } from '../../i18n';
import { FinanceTab, ReceivablesTab } from './Finance';
import { MovementsTab } from './Movements';
import { AttendanceTab, MembersTab, RanksReportTab } from './Activity';
import { rt } from './bits';

type Tab = 'finance' | 'receivables' | 'movements' | 'members' | 'attendance' | 'ranks';
const MONEY: Tab[] = ['finance', 'receivables', 'movements'];
const OTHERS: Tab[] = ['members', 'attendance', 'ranks'];

export function Reports() {
  useLanguage();
  const { hasRole } = useSession();
  const admin = hasRole('admin');
  const params = useLocalSearchParams<{ tab?: string }>();
  const tabs = admin ? [...MONEY, ...OTHERS] : OTHERS;
  const initial = tabs.includes(params.tab as Tab) ? (params.tab as Tab) : tabs[0];
  const [tab, setTab] = useState<Tab>(initial);
  const [version, setVersion] = useState(0);

  return (
    <Screen maxWidth={1200} onRefresh={() => setVersion((v) => v + 1)}>
      <Text variant="title" accessibilityRole="header">{rt('title')}</Text>
      <Tabs value={tab} onChange={setTab} tabs={tabs.map((k) => ({ key: k, label: rt(`tab_${k}`) }))} />
      <React.Fragment key={`${tab}-${version}`}>
        {tab === 'finance' ? <FinanceTab /> : null}
        {tab === 'receivables' ? <ReceivablesTab /> : null}
        {tab === 'movements' ? <MovementsTab /> : null}
        {tab === 'members' ? <MembersTab /> : null}
        {tab === 'attendance' ? <AttendanceTab /> : null}
        {tab === 'ranks' ? <RanksReportTab /> : null}
      </React.Fragment>
    </Screen>
  );
}
