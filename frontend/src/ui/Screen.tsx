import React from 'react';
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, space } from '../theme/tokens';

/**
 * Contenedor de pantalla: fondo papel, scroll, márgenes y ancho máximo.
 * `onRefresh` activa "jalar para actualizar".
 */
export function Screen({
  children, maxWidth = 1200, padded = true, refreshing, onRefresh, scroll = true, style, bottomInset = 0,
}: {
  children: React.ReactNode; maxWidth?: number; padded?: boolean; refreshing?: boolean; onRefresh?: () => void;
  scroll?: boolean; style?: StyleProp<ViewStyle>; bottomInset?: number;
}) {
  const insets = useSafeAreaInsets();
  const inner = (
    <View style={[{
      width: '100%', maxWidth, alignSelf: 'center', gap: space.lg,
      paddingHorizontal: padded ? space.lg : 0, paddingTop: padded ? space.lg : 0,
      paddingBottom: space.xxl + bottomInset + insets.bottom,
    }, style]}>{children}</View>
  );
  if (!scroll) return <View style={{ flex: 1, backgroundColor: palette.paper }}>{inner}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.paper }}
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {inner}
    </ScrollView>
  );
}
