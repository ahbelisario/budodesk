/** «BudoDesk 1.0.8»: versión de la app y, si no coincide, la del servidor (útil para saber si prd ya se actualizó) */
import React, { useEffect, useState } from 'react';
import appJson from '../../app.json';
import { Text } from './primitives';
import { palette } from '../theme/tokens';
import { api } from '../api/client';
import { t } from '../i18n';

export const APP_VERSION: string = appJson.expo.version;

export function AppVersion() {
  const [server, setServer] = useState<string | null>(null);
  useEffect(() => {
    api.public.get<{ version?: string }>('/health').then((r) => setServer(r.version ?? null)).catch(() => {});
  }, []);
  const mismatch = server && server !== APP_VERSION;
  return (
    <Text variant="caption" color={palette.ink3} selectable>
      {`BudoDesk ${APP_VERSION}`}{mismatch ? ` · ${t('common.serverVersion', { version: server })}` : ''}
    </Text>
  );
}
