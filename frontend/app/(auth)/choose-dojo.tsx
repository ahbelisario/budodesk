import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSession } from '@/session/SessionProvider';
import { AuthLayout } from '@/ui/AuthLayout';
import { Button, Card, Icon, Notice, Text } from '@/ui/primitives';
import { palette, radius, space, fonts } from '@/theme/tokens';
import { t } from '@/i18n';
import { errorMessage } from '@/utils/errors';
import { API_URL } from '@/config';
import type { DojoSummary } from '@/api/types';

function DojoRow({ dojo, onPress, busy }: { dojo: DojoSummary; onPress: () => void; busy: boolean }) {
  const color = dojo.color_primary || palette.ink;
  const uri = dojo.logo_url ? (dojo.logo_url.startsWith('http') ? dojo.logo_url : `${API_URL}${dojo.logo_url}`) : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={dojo.name} onPress={onPress} disabled={busy}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg,
        backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, opacity: pressed || busy ? 0.7 : 1,
      })}>
      {uri ? <Image source={{ uri }} style={{ width: 48, height: 48, borderRadius: 12 }} contentFit="contain" />
        : <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.display, fontSize: 20 }} color="#FFFFFF">{(dojo.short_name || dojo.name)[0]?.toUpperCase()}</Text>
        </View>}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{dojo.name}</Text>
        <Text variant="small" color={palette.ink2}>{dojo.roles.filter((r) => r !== 'admin' || !dojo.roles.includes('owner')).map((r) => t(`roles.${r}`)).join(' · ')}</Text>
      </View>
      <Icon name="chevron-right" color={palette.ink3} />
    </Pressable>
  );
}

export default function ChooseDojo() {
  const { status, dojos, switchDojo, logout, dojo } = useSession();
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === 'signedOut') return <Redirect href="/login" />;

  async function pick(id: number) {
    if (dojo?.id === id) { router.replace('/home'); return; }
    setBusyId(id); setError(null);
    try {
      await switchDojo(id);
      router.replace('/home');
    } catch (e) { setError(errorMessage(e)); } finally { setBusyId(null); }
  }

  return (
    <AuthLayout>
      {dojos.length === 0 ? (
        <Card>
          <Text variant="heading" accessibilityRole="header">{t('auth.noDojosTitle')}</Text>
          <Text color={palette.ink2}>{t('auth.noDojosBody')}</Text>
        </Card>
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Text variant="title" accessibilityRole="header">{t('auth.chooseDojoTitle')}</Text>
            <Text color={palette.ink2}>{t('auth.chooseDojoSubtitle')}</Text>
          </View>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <View style={{ gap: space.sm }}>
            {dojos.map((d) => <DojoRow key={d.id} dojo={d} busy={busyId !== null} onPress={() => pick(d.id)} />)}
          </View>
        </>
      )}
      <Button label={t('auth.signOut')} variant="ghost" icon="log-out" onPress={logout} />
    </AuthLayout>
  );
}
