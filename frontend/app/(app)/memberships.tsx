import React from 'react';
import { ComingSoon } from '@/ui/ComingSoon';
import { t } from '@/i18n';

export default function Screen() {
  return <ComingSoon title={t('nav.memberships')} icon="credit-card" />;
}
