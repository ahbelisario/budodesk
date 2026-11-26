/** Aviso de límite del plan Básico, con a quién escribir para cambiar a Pro */
import React from 'react';
import { Notice } from './primitives';
import { t } from '../i18n';

export function PlanNotice({ text, contactEmail, tone = 'warning' }: { text: string; contactEmail: string | null; tone?: 'warning' | 'info' }) {
  return <Notice tone={tone}>{`${text} ${contactEmail ? t('plan.contact', { email: contactEmail }) : t('plan.howToUpgrade')}`}</Notice>;
}
