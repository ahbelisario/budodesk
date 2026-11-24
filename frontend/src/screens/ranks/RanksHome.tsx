/** Grados y exámenes (personal): Exámenes · Listos para examen · Estructura */
import React, { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/primitives';
import { Tabs } from '../../ui/forms';
import { useLanguage } from '../../i18n';
import { ExamsTab, ReadyTab } from './Exams';
import { StructureTab } from './Structure';
import { rt } from './bits';

type TabKey = 'exams' | 'ready' | 'structure';

export function RanksHome() {
  useLanguage();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<TabKey>((['exams', 'ready', 'structure'].includes(params.tab ?? '') ? params.tab : 'exams') as TabKey);
  return (
    <Screen maxWidth={1100}>
      <Text variant="title" accessibilityRole="header">{rt('title')}</Text>
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'exams', label: rt('tab_exams') }, { key: 'ready', label: rt('tab_ready') }, { key: 'structure', label: rt('tab_structure') },
      ]} />
      {tab === 'exams' ? <ExamsTab /> : tab === 'ready' ? <ReadyTab /> : <StructureTab />}
    </Screen>
  );
}
