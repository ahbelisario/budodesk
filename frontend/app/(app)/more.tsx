import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/session/SessionProvider';
import { navFor } from '@/navigation/nav';
import { Screen } from '@/ui/Screen';
import { Card, Divider, Icon, Text } from '@/ui/primitives';
import { palette } from '@/theme/tokens';
import { t } from '@/i18n';

/** Secciones que no caben en las pestañas del celular */
export default function More() {
  const { roles, logout, dojos, user } = useSession();
  const router = useRouter();
  const { more } = navFor(roles, !!user?.is_superadmin);
  const rows = [
    ...more.map((m) => ({ key: m.key, label: t(m.label), icon: m.icon, onPress: () => router.push(m.href as any) })),
    ...(dojos.length > 1 ? [{ key: 'switch', label: t('nav.switchDojo'), icon: 'repeat' as const, onPress: () => router.push('/choose-dojo') }] : []),
    { key: 'logout', label: t('auth.signOut'), icon: 'log-out' as const, onPress: logout },
  ];
  return (
    <Screen maxWidth={640}>
      <Text variant="display" accessibilityRole="header">Más</Text>
      <Card padding={0}>
        {rows.map((r, i) => (
          <View key={r.key}>
            {i > 0 ? <Divider /> : null}
            <Pressable accessibilityRole="link" onPress={r.onPress}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, minHeight: 56, opacity: pressed ? 0.7 : 1 })}>
              <Icon name={r.icon} size={20} color={r.key === 'logout' ? palette.danger : palette.ink} />
              <Text variant="bodyStrong" color={r.key === 'logout' ? palette.danger : palette.ink} style={{ flex: 1 }}>{r.label}</Text>
              {r.key !== 'logout' ? <Icon name="chevron-right" size={18} color={palette.ink3} /> : null}
            </Pressable>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
