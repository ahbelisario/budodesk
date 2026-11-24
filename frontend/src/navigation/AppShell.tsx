/**
 * Marco de la app: barra lateral en pantallas anchas, pestañas abajo en celular.
 */
import React from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../theme/ThemeProvider';
import { palette, radius, space, WIDE_BREAKPOINT, fonts } from '../theme/tokens';
import { Avatar, Icon, Text } from '../ui/primitives';
import { navFor, type NavItem } from './nav';
import { t } from '../i18n';
import { fullName } from '../utils/format';
import { API_URL } from '../config';

export const TAB_BAR_HEIGHT = 64;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DojoMark({ size = 40 }: { size?: number }) {
  const { dojo } = useSession();
  const { accent, onAccent } = useTheme();
  const name = dojo?.short_name || dojo?.name || 'BudoDesk';
  if (dojo?.logo_url) {
    const uri = dojo.logo_url.startsWith('http') ? dojo.logo_url : `${API_URL}${dojo.logo_url}`;
    return <Image source={{ uri }} accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 4 }} contentFit="contain" />;
  }
  return (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.display, fontSize: size * 0.45 }} color={onAccent}>{name[0]?.toUpperCase()}</Text>
    </View>
  );
}

function SidebarItem({ item, active, onPress, badge }: { item: NavItem; active: boolean; onPress: () => void; badge?: number }) {
  const { accent, onAccent } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ hovered, pressed }: any) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.sm,
        backgroundColor: active ? palette.darkRaised : hovered || pressed ? '#242422' : 'transparent',
      })}
    >
      <View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: active ? accent : 'transparent' }} />
      <Icon name={item.icon} size={18} color={active ? '#FFFFFF' : '#D6D2C7'} />
      <Text variant={active ? 'bodyStrong' : 'body'} color={active ? '#FFFFFF' : '#D6D2C7'} style={{ flex: 1 }}>{t(item.label)}</Text>
      {badge ? (
        <View style={{ backgroundColor: accent, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text variant="caption" color={onAccent}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Sidebar() {
  const { dojo, dojos, user, roles, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { main } = navFor(roles);
  const top = main.filter((n) => n.key !== 'settings');
  const settings = main.find((n) => n.key === 'settings');
  const mainRole = roles.includes('owner') ? 'owner' : roles.includes('admin') ? 'admin' : roles[0];

  return (
    <View style={{ width: 248, backgroundColor: palette.ink, paddingVertical: space.lg, paddingHorizontal: space.md, gap: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 }}>
        <DojoMark />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" color="#FFFFFF" numberOfLines={1} style={{ fontFamily: fonts.display, fontSize: 16 }}>{dojo?.short_name || dojo?.name}</Text>
          {dojos.length > 1 ? (
            <Pressable accessibilityRole="button" onPress={() => router.push('/choose-dojo')}>
              <Text variant="caption" color={palette.mutedOnDark}>{t('nav.switchDojo')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 2 }}>
        {top.map((item) => (
          <SidebarItem key={item.key} item={item} active={isActive(pathname, item.href)} onPress={() => router.push(item.href as any)} />
        ))}
      </ScrollView>
      <View style={{ borderTopWidth: 1, borderTopColor: palette.darkLine, paddingTop: space.md, gap: 2 }}>
        {settings ? <SidebarItem item={settings} active={isActive(pathname, settings.href)} onPress={() => router.push(settings.href as any)} /> : null}
        <Pressable accessibilityRole="link" onPress={() => router.push('/profile')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 }}>
          <Avatar name={user ? fullName(user) : '?'} photoUrl={user?.photo_url} size={32} />
          <View style={{ flex: 1 }}>
            <Text variant="smallStrong" color="#FFFFFF" numberOfLines={1}>{user ? fullName(user) : ''}</Text>
            <Text variant="caption" color={palette.mutedOnDark}>{mainRole ? t(`roles.${mainRole}`) : ''}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('auth.signOut')} onPress={logout} hitSlop={8}>
            <Icon name="log-out" size={18} color={palette.mutedOnDark} />
          </Pressable>
        </Pressable>
      </View>
    </View>
  );
}

function TabBar() {
  const { roles } = useSession();
  const { accent } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { tabs, more, staff } = navFor(roles);
  const items: NavItem[] = staff ? [...tabs, { key: 'more', href: '/more', label: 'Más', icon: 'menu' }] : tabs;
  const moreActive = staff && more.some((m) => isActive(pathname, m.href));

  return (
    <View accessibilityRole="tablist" style={{
      flexDirection: 'row', backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.line,
      paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8), minHeight: TAB_BAR_HEIGHT,
    }}>
      {items.map((item) => {
        const active = item.key === 'more' ? moreActive || isActive(pathname, '/more') : isActive(pathname, item.href);
        const color = active ? accent : palette.ink2;
        return (
          <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: active }}
            onPress={() => router.push(item.href as any)}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 48 }}>
            <Icon name={item.icon} size={22} color={color} />
            <Text variant="caption" color={color} style={{ fontSize: 11, fontFamily: active ? fonts.bodySemibold : fonts.body }}>
              {item.label.startsWith('nav.') ? t(item.short ?? item.label) : item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.paper }}>
        <Sidebar />
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <View style={{ flex: 1 }}>{children}</View>
      <TabBar />
    </View>
  );
}

export function useIsWide() {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}
