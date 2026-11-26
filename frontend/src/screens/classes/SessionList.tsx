/**
 * Clases en lista (solo personal): todas las clases con fecha y detalle, sin límite de fechas.
 * Vistas: próximas · pasadas · todas · editadas (la última edición primero, para encontrar una
 * clase que se movió de fecha). Búsqueda, disciplina, canceladas y «ver más».
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { classesApi, type ListedSession, type ListMeta, type ListView } from '../../api/classes';
import { errorMessage } from '../../utils/errors';
import { Badge, Button, Card, EmptyState, Loading, Notice, Text } from '../../ui/primitives';
import { FilterChips, SearchField, SwitchRow } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useIsWide } from '../../navigation/AppShell';
import { getLanguage } from '../../i18n';
import { capitalize, dateTimeShort, hm, parseDay } from '../../utils/format';
import { ageLabel, ct, spotsLabel, statusBadge } from './bits';

const VIEWS: ListView[] = ['upcoming', 'past', 'all', 'edited'];

/** «jueves, 4 de marzo de 2019» (con año: en la lista puede haber fechas de cualquier año) */
function dateHeader(ymd: string) {
  return capitalize(new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-US' : 'es-MX',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parseDay(ymd)));
}

function ListRow({ s, edited, onPress }: { s: ListedSession; edited: boolean; onPress: () => void }) {
  const { accent } = useTheme();
  const wide = useIsWide();
  const st = statusBadge(s);
  const ages = ageLabel(s.min_age, s.max_age);
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${s.title}, ${dateHeader(s.session_date)} ${hm(s.start_time)}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.sm,
        borderRadius: 10, backgroundColor: pressed ? palette.paper : 'transparent', opacity: s.status === 'cancelled' ? 0.65 : 1 })}>
      <View style={{ width: 4, borderRadius: 2, backgroundColor: s.color ?? accent }} />
      <View style={{ width: wide ? 110 : 98 }}>
        <Text variant="smallStrong">{hm(s.start_time)} – {hm(s.end_time)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ textDecorationLine: s.status === 'cancelled' ? 'line-through' : 'none' }}>{s.title}</Text>
        <Text variant="small" color={palette.ink2} numberOfLines={2}>
          {[s.discipline, s.instructor_name, s.location, ages,
            s.status !== 'scheduled' ? null : s.capacity == null ? ct('listBooked', { count: s.booked_count }) : spotsLabel(s)].filter(Boolean).join(' · ')}
        </Text>
        {edited && s.edited_at ? <Text variant="caption" color={palette.ink2}>{ct('editedAt', { when: dateTimeShort(s.edited_at) })}</Text> : null}
      </View>
      {st ? <View><Badge label={st.label} tone={st.tone} /></View> : null}
    </Pressable>
  );
}

export function SessionList({ disciplines }: { disciplines: { key: string; label: string }[] }) {
  const router = useRouter();
  const [view, setView] = useState<ListView>('upcoming');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [disc, setDisc] = useState('all');
  const [cancelled, setCancelled] = useState(false);
  const [rows, setRows] = useState<ListedSession[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Búsqueda con pausa para no consultar en cada tecla
  useEffect(() => { const h = setTimeout(() => setQuery(search.trim()), 350); return () => clearTimeout(h); }, [search]);

  const params = (page: number) => ({
    view, page, page_size: 30, q: query || undefined,
    discipline_id: disc !== 'all' ? Number(disc) : undefined, include_cancelled: cancelled || undefined,
  });

  useEffect(() => {
    const my = ++seq.current;
    setLoading(true); setError(null);
    classesApi.sessionsList(params(1))
      .then((r) => { if (my === seq.current) { setRows(r.data); setMeta(r.meta); } })
      .catch((e) => { if (my === seq.current) setError(errorMessage(e)); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [view, query, disc, cancelled]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    if (!meta) return;
    setMore(true);
    try {
      const r = await classesApi.sessionsList(params(meta.page + 1));
      setRows((x) => [...x, ...r.data]); setMeta(r.meta);
    } catch (e) { setError(errorMessage(e)); } finally { setMore(false); }
  }

  const edited = view === 'edited';
  return (
    <View style={{ gap: space.md }}>
      <FilterChips label={ct('viewList')} value={view} onChange={setView} options={VIEWS.map((k) => ({ key: k, label: ct(`lv_${k}`) }))} />
      {edited ? <Text variant="small" color={palette.ink2}>{ct('lv_editedHint')}</Text> : null}
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchField value={search} onChange={setSearch} placeholder={ct('listSearch')} />
        <View style={{ minWidth: 220 }}><SwitchRow label={ct('listCancelled')} value={cancelled} onChange={setCancelled} /></View>
      </View>
      {disciplines.length > 2 ? <FilterChips label={ct('discipline')} options={disciplines} value={disc} onChange={setDisc} /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loading ? <Loading /> : rows.length === 0 ? (
        <Card><EmptyState icon="list" title={ct('listEmpty')} /></Card>
      ) : (
        <Card style={{ gap: 0 }}>
          <Text variant="small" color={palette.ink2} style={{ paddingBottom: space.xs }}>{ct('listCount', { count: meta?.total ?? rows.length })}</Text>
          {rows.map((s, i) => {
            // En «editadas» el orden es por edición: la fecha va en cada fila
            const header = edited || i === 0 || rows[i - 1].session_date !== s.session_date;
            const isToday = meta?.today === s.session_date;
            return (
              <View key={s.id}>
                {header ? (
                  <Text variant="smallStrong" color={isToday ? palette.ink : palette.ink2}
                    style={{ paddingTop: i === 0 ? 0 : space.md, paddingBottom: 2 }}>
                    {dateHeader(s.session_date)}{isToday ? ` · ${ct('today')}` : ''}
                  </Text>
                ) : null}
                <ListRow s={s} edited={edited} onPress={() => router.push(`/classes/${s.id}` as never)} />
              </View>
            );
          })}
          {meta && meta.page < meta.total_pages ? (
            <View style={{ paddingTop: space.sm, alignItems: 'center' }}>
              <Button label={ct('listMore')} variant="secondary" size="sm" loading={more} onPress={loadMore} />
            </View>
          ) : null}
        </Card>
      )}
    </View>
  );
}
