import React, { useEffect, useState } from 'react';
import { Link, useLocalSearchParams } from 'expo-router';
import { api } from '@/api/client';
import { usePublicDojo } from '@/session/usePublicDojo';
import { AuthLayout } from '@/ui/AuthLayout';
import { Loading, Notice, Text } from '@/ui/primitives';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { t } from '@/i18n';
import { errorMessage } from '@/utils/errors';

export default function VerifyEmail() {
  const params = useLocalSearchParams<{ token?: string; dojo?: string }>();
  const { dojo } = usePublicDojo(params.dojo);
  const [state, setState] = useState<'working' | 'ok' | 'error'>(params.token ? 'working' : 'error');
  const [error, setError] = useState<string | null>(params.token ? null : t('auth.missingToken'));

  useEffect(() => {
    if (!params.token) return;
    api.public.post('/account/verify-email', { token: params.token })
      .then(() => setState('ok'))
      .catch((e) => { setError(errorMessage(e)); setState('error'); });
  }, [params.token]);

  return (
    <ThemeProvider accent={dojo?.color_primary}>
      <AuthLayout dojo={dojo}>
        {state === 'working' ? <Loading label={t('auth.verifyTitle')} /> : state === 'ok' ? (
          <Notice tone="success" title={t('auth.verifyOk')}>{t('auth.verifyPending')}</Notice>
        ) : <Notice tone="danger">{error ?? t('auth.linkInvalid')}</Notice>}
        <Link href="/login" style={{ alignSelf: 'center' }}>
          <Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{t('auth.goToSignIn')}</Text>
        </Link>
      </AuthLayout>
    </ThemeProvider>
  );
}
