/** Reportes: el dinero (finanzas, por cobrar, gastos e ingresos) solo para dueño/admin; lo demás para el personal */
import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '../../session/SessionProvider';
import { Screen } from '../../ui/Screen';
import { Card, Text } from '../../ui/primitives';
import { useSubscription } from '../../session/useSubscription';
import { PlanNotice } from '../../ui/PlanNotice';
import { t } from '../../i18n';
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
  // Sin finanzas en el plan: las pestañas de dinero se ven, pero con el aviso en lugar del contenido
  const { limits, planName, contactEmail } = useSubscription();
  const noFinance = !!limits && !limits.finance;
  const locked = noFinance && MONEY.includes(tab);
  // Si no se pidió una pestaña, en Básico se abre la primera que sí se puede usar
  React.useEffect(() => { if (noFinance && !params.tab && MONEY.includes(tab)) setTab('members'); }, [noFinance]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen maxWidth={1200} onRefresh={() => setVersion((v) => v + 1)}>
      <Text variant="title" accessibilityRole="header">{rt('title')}</Text>
      <Tabs value={tab} onChange={setTab} tabs={tabs.map((k) => ({ key: k, label: rt(`tab_${k}`) }))} />
      <React.Fragment key={`${tab}-${version}`}>
        {locked ? (
          <Card style={{ gap: 8 }}>
            <Text variant="bodyStrong">{t('plan.financeTitle')}</Text>
            <PlanNotice tone="info" contactEmail={contactEmail} text={t('plan.limit_finance', { plan: planName })} />
          </Card>
        ) : null}
        {!locked && tab === 'finance' ? <FinanceTab /> : null}
        {!locked && tab === 'receivables' ? <ReceivablesTab /> : null}
        {!locked && tab === 'movements' ? <MovementsTab /> : null}
        {tab === 'members' ? <MembersTab /> : null}
        {tab === 'attendance' ? <AttendanceTab /> : null}
        {tab === 'ranks' ? <RanksReportTab /> : null}
      </React.Fragment>
    </Screen>
  );
}
