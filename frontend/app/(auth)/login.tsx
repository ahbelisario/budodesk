import React, { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { usePublicDojo } from '@/session/usePublicDojo';
import { AuthLayout } from '@/ui/AuthLayout';
import { Button, Field, Notice, Text } from '@/ui/primitives';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { palette, space } from '@/theme/tokens';
import { t } from '@/i18n';
import { errorMessage } from '@/utils/errors';

export default function Login() {
  const { status, login } = useSession();
  const { slug, dojo } = usePublicDojo();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  if (status === 'ready') return <Redirect href="/home" />;
  if (status === 'chooseDojo') return <Redirect href="/choose-dojo" />;

  async function submit() {
    if (!identifier.trim() || !password) return;
    setBusy(true); setError(null);
    try {
      // dojo_slug solo si la persona pertenece a ese dojo; si no, el servidor decide
      await login(identifier.trim(), password, slug).catch(async (e) => {
        if (e?.code === 'NOT_A_MEMBER' && slug) return login(identifier.trim(), password, null);
        throw e;
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemeProvider accent={dojo?.color_primary}>
      <AuthLayout dojo={dojo}>
        <View style={{ gap: 6 }}>
          <Text variant="title" accessibilityRole="header">{t('auth.signInTitle')}</Text>
          <Text color={palette.ink2}>{t('auth.signInSubtitle')}</Text>
        </View>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <View style={{ gap: space.md }}>
          <Field
            label={t('auth.identifier')} value={identifier} onChangeText={setIdentifier}
            autoCapitalize="none" autoCorrect={false} autoComplete="username" keyboardType="email-address"
            textContentType="username" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Field
            ref={passwordRef} label={t('auth.password')} value={password} onChangeText={setPassword}
            secureToggle autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit}
          />
          <Link href="/forgot-password" style={{ alignSelf: 'flex-end' }}>
            <Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{t('auth.forgot')}</Text>
          </Link>
        </View>
        <Button label={t('auth.signIn')} onPress={submit} loading={busy} disabled={!identifier.trim() || !password} fullWidth />
      </AuthLayout>
    </ThemeProvider>
  );
}
