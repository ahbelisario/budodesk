import React, { useState } from 'react';
import { View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { api } from '../api/client';
import { usePublicDojo } from '../session/usePublicDojo';
import { AuthLayout } from './AuthLayout';
import { Button, Field, Notice, Text } from './primitives';
import { ThemeProvider } from '../theme/ThemeProvider';
import { palette, space } from '../theme/tokens';
import { t } from '../i18n';
import { errorMessage } from '../utils/errors';

/** Crear contraseña (acceso nuevo) o restablecerla, a partir del token del correo */
export function SetPasswordForm({ mode }: { mode: 'reset' | 'set' }) {
  const params = useLocalSearchParams<{ token?: string; dojo?: string }>();
  const { dojo } = usePublicDojo(params.dojo);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = pw2.length > 0 && pw !== pw2;

  async function submit() {
    if (pw.length < 10 || pw !== pw2 || !params.token) return;
    setBusy(true); setError(null);
    try {
      await api.public.post('/account/password/reset', { token: params.token, password: pw });
      setDone(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <ThemeProvider accent={dojo?.color_primary}>
      <AuthLayout dojo={dojo}>
        <View style={{ gap: 6 }}>
          <Text variant="title" accessibilityRole="header">{mode === 'set' ? t('auth.setTitle') : t('auth.resetTitle')}</Text>
          {mode === 'set' ? <Text color={palette.ink2}>{t('auth.setBody')}</Text> : null}
        </View>
        {!params.token ? <Notice tone="danger">{t('auth.missingToken')}</Notice>
          : done ? <Notice tone="success">{t('auth.passwordUpdated')}</Notice> : (
            <View style={{ gap: space.md }}>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Field label={t('auth.newPassword')} value={pw} onChangeText={setPw} secureToggle autoComplete="new-password"
                textContentType="newPassword" hint={t('auth.passwordHint')} />
              <Field label={t('auth.confirmPassword')} value={pw2} onChangeText={setPw2} secureToggle autoComplete="new-password"
                error={mismatch ? t('auth.passwordsDontMatch') : null} onSubmitEditing={submit} />
              <Button label={t('common.save')} onPress={submit} loading={busy} disabled={pw.length < 10 || pw !== pw2} fullWidth />
            </View>
          )}
        <Link href="/login" style={{ alignSelf: 'center' }}>
          <Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{t('auth.goToSignIn')}</Text>
        </Link>
      </AuthLayout>
    </ThemeProvider>
  );
}
