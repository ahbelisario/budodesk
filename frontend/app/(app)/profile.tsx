import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { api } from '@/api/client';
import { Screen } from '@/ui/Screen';
import { Avatar, Badge, Button, Card, Divider, Field, Notice, SectionHeader, Text } from '@/ui/primitives';
import { palette, space } from '@/theme/tokens';
import { getLanguage, setLanguage, t, type Lang } from '@/i18n';
import { fullName } from '@/utils/format';
import { errorMessage } from '@/utils/errors';
import { ApiError } from '@/api/client';

export default function Profile() {
  const { user, dojo, dojos, roles, logout } = useSession();
  const router = useRouter();
  const [lang, setLang] = useState<Lang>(getLanguage());
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);

  async function changeLang(l: Lang) {
    setLang(l);
    await setLanguage(l);
    api.patch('/me/settings', { language: l }).catch(() => {});
  }

  async function changePassword() {
    setMsg(null); setFieldErr(null);
    if (next.length < 10) { setFieldErr(t('auth.passwordHint')); return; }
    setSaving(true);
    try {
      await api.post('/me/password', { current_password: current, new_password: next });
      setCurrent(''); setNext('');
      setMsg({ tone: 'success', text: getLanguage() === 'en' ? 'Password updated. Other devices were signed out.' : 'Contraseña actualizada. Se cerró la sesión en tus otros dispositivos.' });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ApiError && e.code === 'WRONG_PASSWORD' ? (getLanguage() === 'en' ? 'Current password is incorrect.' : 'La contraseña actual no es correcta.') : errorMessage(e) });
    } finally { setSaving(false); }
  }

  if (!user) return null;
  return (
    <Screen maxWidth={720}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar name={fullName(user)} photoUrl={user.photo_url} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title" accessibilityRole="header">{fullName(user)}</Text>
          <Text variant="small" color={palette.ink2}>{user.email}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {roles.filter((r) => r !== 'admin' || !roles.includes('owner')).map((r) => <Badge key={r} label={t(`roles.${r}`)} />)}
          </View>
        </View>
      </View>

      <Card>
        <SectionHeader title={t('common.language')} />
        <View style={{ flexDirection: 'row', gap: space.xs }}>
          <Button label="Español" size="sm" variant={lang === 'es' ? 'dark' : 'secondary'} onPress={() => changeLang('es')} />
          <Button label="English" size="sm" variant={lang === 'en' ? 'dark' : 'secondary'} onPress={() => changeLang('en')} />
        </View>
      </Card>

      {dojos.length > 1 ? (
        <Card>
          <SectionHeader title={t('nav.switchDojo')} />
          <Text variant="small" color={palette.ink2}>{dojo?.name}</Text>
          <Button label={t('nav.switchDojo')} variant="secondary" icon="repeat" onPress={() => router.push('/choose-dojo')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      <Card>
        <SectionHeader title={getLanguage() === 'en' ? 'Change password' : 'Cambiar contraseña'} />
        {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        <Field label={getLanguage() === 'en' ? 'Current password' : 'Contraseña actual'} value={current} onChangeText={setCurrent} secureToggle autoComplete="current-password" />
        <Field label={t('auth.newPassword')} value={next} onChangeText={setNext} secureToggle autoComplete="new-password" hint={t('auth.passwordHint')} error={fieldErr} />
        <Button label={t('common.save')} variant="dark" loading={saving} disabled={!current || !next} onPress={changePassword} style={{ alignSelf: 'flex-start' }} />
      </Card>

      <Divider />
      <Button label={t('auth.signOut')} variant="danger" icon="log-out" onPress={logout} style={{ alignSelf: 'flex-start' }} />
    </Screen>
  );
}
