import React, { useState } from 'react';
import { View } from 'react-native';
import { Link } from 'expo-router';
import { api } from '@/api/client';
import { usePublicDojo } from '@/session/usePublicDojo';
import { AuthLayout } from '@/ui/AuthLayout';
import { Button, Field, Notice, Text } from '@/ui/primitives';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette, space } from '@/theme/tokens';
import { t } from '@/i18n';
import { errorMessage } from '@/utils/errors';

export default function ForgotPassword() {
  const { dojo } = usePublicDojo();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.includes('@')) return;
    setBusy(true); setError(null);
    try {
      await api.public.post('/account/password/forgot', { email: email.trim() });
      setSent(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <ThemeProvider accent={dojo?.color_primary}>
      <AuthLayout dojo={dojo}>
        <View style={{ gap: 6 }}>
          <Text variant="title" accessibilityRole="header">{t('auth.forgotTitle')}</Text>
          <Text color={palette.ink2}>{t('auth.forgotBody')}</Text>
        </View>
        {sent ? <Notice tone="success">{t('auth.forgotSent')}</Notice> : (
          <View style={{ gap: space.md }}>
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
              keyboardType="email-address" returnKeyType="send" onSubmitEditing={submit} />
            <Button label={t('auth.sendLink')} onPress={submit} loading={busy} disabled={!email.includes('@')} fullWidth />
          </View>
        )}
        <Link href="/login" style={{ alignSelf: 'center' }}>
          <Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{t('auth.goToSignIn')}</Text>
        </Link>
      </AuthLayout>
    </ThemeProvider>
  );
}
