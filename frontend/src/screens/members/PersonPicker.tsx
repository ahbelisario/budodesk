/** Elegir a un miembro del dojo buscando por nombre (para tutores, pagos, etc.) */
import React, { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { membersApi, type MemberRow } from '../../api/members';
import { Avatar, Icon, Loading, Text } from '../../ui/primitives';
import { SearchField } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { fullName } from '../../utils/format';
import { mt } from './bits';

export type PickedPerson = { id: number; name: string; photo_url?: string | null };

export function PersonPicker({ label, value, onChange, exclude = [], status = 'active', error }: {
  label: string; value: PickedPerson | null; onChange: (p: PickedPerson | null) => void; exclude?: number[];
  status?: 'active' | 'all'; error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || q.trim().length < 2) { setRows([]); return; }
    let alive = true;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        const r = await membersApi.list({ q: q.trim(), status, page_size: 20 });
        if (alive) setRows(r.data.filter((m) => !exclude.includes(m.id)));
      } catch { if (alive) setRows([]); } finally { if (alive) setLoading(false); }
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: 6 }}>
      <Text variant="smallStrong">{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value?.name ?? mt('pickPerson')}`} onPress={() => { setQ(''); setOpen(true); }}
        style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: error ? palette.danger : palette.line, backgroundColor: palette.surface,
          paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {value ? <Avatar name={value.name} photoUrl={value.photo_url} size={28} /> : <Icon name="user" size={18} color={palette.ink3} />}
        <Text style={{ flex: 1 }} color={value ? palette.ink : palette.ink3} numberOfLines={1}>{value?.name ?? mt('pickPerson')}</Text>
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={mt('remove')} hitSlop={8} onPress={() => onChange(null)}><Icon name="x" size={16} color={palette.ink2} /></Pressable>
        ) : <Icon name="search" size={16} color={palette.ink2} />}
      </Pressable>
      {error ? <Text variant="small" color={palette.danger}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(26,26,26,0.45)', justifyContent: 'center', padding: space.lg }}>
          <Pressable onPress={() => {}} style={{ backgroundColor: palette.surface, borderRadius: radius.xl, width: '100%', maxWidth: 460, alignSelf: 'center', height: 460, maxHeight: '85%', overflow: 'hidden' }}>
            <View style={{ padding: space.md, gap: space.sm, borderBottomWidth: 1, borderBottomColor: palette.lineSoft }}>
              <Text variant="heading">{label}</Text>
              <SearchField value={q} onChange={setQ} placeholder={mt('searchPerson')} />
            </View>
            {loading ? <Loading /> : (
              <FlatList data={rows} keyExtractor={(m) => String(m.id)} keyboardShouldPersistTaps="handled"
                ListEmptyComponent={<Text variant="small" color={palette.ink2} style={{ padding: space.md }}>{q.trim().length < 2 ? mt('searchPerson') : mt('noResults')}</Text>}
                renderItem={({ item }) => {
                  const name = fullName(item);
                  return (
                    <Pressable accessibilityRole="button" onPress={() => { onChange({ id: item.id, name, photo_url: item.photo_url }); setOpen(false); }}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.md, minHeight: 56, backgroundColor: pressed ? palette.paper : 'transparent' })}>
                      <Avatar name={name} photoUrl={item.photo_url} size={36} />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong" numberOfLines={1}>{name}</Text>
                        <Text variant="caption" color={palette.ink2} numberOfLines={1}>{item.email ?? item.phone ?? ''}</Text>
                      </View>
                    </Pressable>
                  );
                }} />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
