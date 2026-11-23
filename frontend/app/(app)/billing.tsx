import React from 'react';
import { ComingSoon } from '@/ui/ComingSoon';
import { t } from '@/i18n';

export default function Screen() {
  return <ComingSoon title={t('nav.billing')} icon="dollar-sign" />;
}
