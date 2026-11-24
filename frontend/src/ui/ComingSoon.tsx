import React from 'react';
import { Screen } from './Screen';
import { Card, EmptyState, Text, type IconName } from './primitives';
import { t } from '../i18n';

/** Marcador temporal de las secciones que aún se están migrando */
export function ComingSoon({ title, icon = 'tool' }: { title: string; icon?: IconName }) {
  return (
    <Screen>
      <Text variant="display" accessibilityRole="header">{title}</Text>
      <Card>
        <EmptyState icon={icon} title={title} body={t('common.comingSoon')} />
      </Card>
    </Screen>
  );
}
