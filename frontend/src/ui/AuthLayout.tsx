/**
 * Marco de las pantallas públicas (login, contraseña, verificación):
 * panel oscuro con la marca del dojo a la izquierda en pantallas anchas.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, space, WIDE_BREAKPOINT, fonts } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './primitives';
import { getLanguage, setLanguage, useLanguage } from '../i18n';
import { API_URL } from '../config';
import type { PublicDojo } from '../api/types';

const budodeskLogo = require('../../assets/images/logo.png');
const budodeskEmblem = require('../../assets/images/emblem.png');

function LanguageSwitch({ dark }: { dark?: boolean }) {
  useLanguage();
  const lang = getLanguage();
  const color = (l: string) => (lang === l ? (dark ? '#FFFFFF' : palette.ink) : dark ? palette.mutedOnDark : palette.ink2);
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
      {(['es', 'en'] as const).map((l, i) => (
        <React.Fragment key={l}>
          {i > 0 ? <Text color={dark ? palette.mutedOnDark : palette.ink3}>·</Text> : null}
          <Pressable accessibilityRole="button" accessibilityState={{ selected: lang === l }} onPress={() => setLanguage(l)} hitSlop={8} style={{ padding: 6 }}>
            <Text variant="smallStrong" color={color(l)}>{l.toUpperCase()}</Text>
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

export function DojoBrand({ dojo, size = 56, dark }: { dojo: PublicDojo | null; size?: number; dark?: boolean }) {
  const { accent, onAccent } = useTheme();
  if (!dojo) {
    // Sobre fondo oscuro el logotipo completo no se lee: emblema + nombre en blanco
    return dark ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityLabel="BudoDesk">
        <Image source={budodeskEmblem} style={{ width: size, height: size }} contentFit="contain" />
        <Text style={{ fontFamily: fonts.display, fontSize: 22 }} color="#FFFFFF">BudoDesk</Text>
      </View>
    ) : <Image source={budodeskLogo} accessibilityLabel="BudoDesk" style={{ width: size * 3.4, height: size }} contentFit="contain" />;
  }
  const uri = dojo.logo_url ? (dojo.logo_url.startsWith('http') ? dojo.logo_url : `${API_URL}${dojo.logo_url}`) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      {uri ? <Image source={{ uri }} accessibilityLabel={dojo.name} style={{ width: size, height: size, borderRadius: size / 4 }} contentFit="contain" />
        : (
          <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.display, fontSize: size * 0.45 }} color={onAccent}>{(dojo.short_name || dojo.name)[0]?.toUpperCase()}</Text>
          </View>
        )}
      <View style={{ flexShrink: 1 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 26 }} color={dark ? '#FFFFFF' : palette.ink}>{dojo.short_name || dojo.name}</Text>
        {dojo.short_name ? <Text variant="small" color={dark ? palette.mutedOnDark : palette.ink2}>{dojo.name}</Text> : null}
      </View>
    </View>
  );
}

export function AuthLayout({ dojo, children }: { dojo?: PublicDojo | null; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE_BREAKPOINT;

  const form = (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: space.lg, paddingTop: space.lg + insets.top, paddingBottom: space.xl + insets.bottom }}
      keyboardShouldPersistTaps="handled" style={{ backgroundColor: palette.paper }}>
      <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: space.lg }}>
        {!wide ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
            <DojoBrand dojo={dojo ?? null} size={44} />
            <LanguageSwitch />
          </View>
        ) : null}
        {children}
      </View>
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1, maxWidth: 560, backgroundColor: palette.ink, padding: space.xxl, justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <DojoBrand dojo={dojo ?? null} dark />
              <LanguageSwitch dark />
            </View>
            <View style={{ gap: space.md }}>
              <Text style={{ fontFamily: fonts.display, fontSize: 40, lineHeight: 48 }} color="#FFFFFF">
                {getLanguage() === 'en' ? 'Train. Progress.\nBelong.' : 'Entrena. Avanza.\nPertenece.'}
              </Text>
              <Text color={palette.mutedOnDark}>
                {getLanguage() === 'en' ? 'Your classes, ranks and payments in one place.' : 'Tus clases, grados y pagos en un solo lugar.'}
              </Text>
            </View>
            <Text variant="caption" color={palette.mutedOnDark}>BudoDesk</Text>
          </View>
          <View style={{ flex: 1 }}>{form}</View>
        </View>
      ) : form}
    </KeyboardAvoidingView>
  );
}
