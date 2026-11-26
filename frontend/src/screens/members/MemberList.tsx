/**
 * Lista de miembros con búsqueda, filtros y paginación.
 * Ancha: filas tipo tabla. Celular: tarjetas compactas.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { membersApi, type MemberRow, type MemberStatus, type DisciplineDef } from '../../api/members';
import type { Role } from '../../api/types';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { useSubscription } from '../../session/useSubscription';
import { PlanNotice } from '../../ui/PlanNotice';
import { Avatar, Badge, Button, Card, Divider, EmptyState, Loading, Notice, Text } from '../../ui/primitives';
import { FilterChips, SearchField, Select } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { useIsWide } from '../../navigation/AppShell';
import { t, useLanguage } from '../../i18n';
import { dayShort, fullName, money } from '../../utils/format';
import { RankChip, StatusBadge, mt } from './bits';

type StatusFilter = MemberStatus | 'all';
const PAGE = 30;

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return d;
}

function Row({ m, wide, financial, onPress }: { m: MemberRow; wide: boolean; financial: boolean; onPress: () => void }) {
  const name = fullName(m);
  const owes = financial && (m.balance_due ?? 0) > 0;
  const meta = [
    m.is_minor ? mt('minor') : null,
    m.age != null ? mt('age', { count: m.age }) : null,
    m.member_number ? `#${m.member_number}` : null,
  ].filter(Boolean).join(' · ');
  const membership = m.active_membership ? m.active_membership.plan : mt('noMembership');
  const last = m.last_attendance ? mt('lastClass', { date: dayShort(m.last_attendance) }) : mt('neverAttended');

  return (
    <Pressable accessibilityRole="link" accessibilityLabel={name} onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: space.sm, paddingHorizontal: space.md, backgroundColor: pressed ? palette.paper : 'transparent' })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar name={name} photoUrl={m.photo_url} size={wide ? 40 : 44} />
        <View style={{ flex: wide ? 2.2 : 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{name}</Text>
            {m.status !== 'active' ? <StatusBadge status={m.status} /> : null}
          </View>
          {meta ? <Text variant="caption" color={palette.ink2} numberOfLines={1}>{meta}</Text> : null}
          {!wide ? (
            <View style={{ gap: 4, marginTop: 2 }}>
              {m.ranks.slice(0, 2).map((r) => <RankChip key={r.discipline_id} r={r} showDiscipline={m.ranks.length > 1} />)}
              <Text variant="caption" color={owes ? palette.danger : palette.ink2} numberOfLines={1}>
                {[membership, owes ? mt('owes', { amount: money(m.balance_due) }) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null}
        </View>
        {wide ? (
          <>
            <View style={{ flex: 1.6, minWidth: 0, gap: 4 }}>
              {m.ranks.length ? m.ranks.slice(0, 2).map((r) => <RankChip key={r.discipline_id} r={r} showDiscipline={m.ranks.length > 1} />)
                : <Text variant="small" color={palette.ink3}>—</Text>}
            </View>
            <View style={{ flex: 1.4, minWidth: 0, gap: 2 }}>
              <Text variant="small" numberOfLines={1} color={m.active_membership ? palette.ink : palette.ink3}>{membership}</Text>
              {owes ? <Text variant="caption" color={palette.danger}>{mt('owes', { amount: money(m.balance_due) })}</Text> : null}
            </View>
            <Text variant="small" color={palette.ink2} style={{ flex: 1.1 }} numberOfLines={1}>{last}</Text>
          </>
        ) : null}
        <Text color={palette.ink3}>›</Text>
      </View>
    </Pressable>
  );
}

export function MemberList() {
  useLanguage();
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string; new?: string }>();
  const { hasRole } = useSession();
  const wide = useIsWide();
  const canCreate = hasRole('admin', 'staff');
  const financial = hasRole('admin', 'staff');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>((['pending', 'active', 'inactive', 'all'].includes(params.status ?? '') ? params.status : 'active') as StatusFilter);
  const [role, setRole] = useState<Role | null>(null);
  const [disc, setDisc] = useState<number | null>(null);
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dq = useDebounced(q);

  // Compatibilidad con /members?new=1 (botón del inicio)
  useEffect(() => { if (params.new) router.replace('/members/new'); }, [params.new]); // eslint-disable-line react-hooks/exhaustive-deps

  const structure = useApi(() => membersApi.structure(), []);
  const disciplines: DisciplineDef[] = structure.data ?? [];

  async function load(p: number) {
    if (p === 1) setLoading(true); else setMore(true);
    setError(null);
    try {
      const r = await membersApi.list({ q: dq || undefined, status, role: role ?? undefined, discipline_id: disc ?? undefined, page: p, page_size: PAGE });
      setRows((prev) => (p === 1 ? r.data : [...prev, ...r.data]));
      setTotal(r.meta?.total ?? r.data.length);
      setPage(p);
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); setMore(false); }
  }
  useEffect(() => { load(1); }, [dq, status, role, disc]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = !!(dq || role || disc || status !== 'active');
  // Plan Básico: uso de alumnos activos y aviso al llegar al límite
  const { sub, planName, contactEmail, reload: reloadSub } = useSubscription();
  const limit = sub?.limits.students ?? null;
  const used = sub?.usage.students ?? 0;
  useEffect(() => { reloadSub(); }, [total]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen onRefresh={() => load(1)} refreshing={false}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' }}>
        <View style={{ gap: 2 }}>
          <Text variant="title" accessibilityRole="header">{mt('title')}</Text>
          {!loading ? <Text variant="small" color={palette.ink2}>{mt('subtitle', { count: total })}</Text> : null}
          {canCreate && limit != null ? (
            <Text variant="small" color={used >= limit ? palette.danger : palette.ink2}>{t('plan.studentsUsage', { current: used, limit, plan: planName })}</Text>
          ) : null}
        </View>
        {canCreate ? <Button label={mt('newMember')} icon="user-plus" onPress={() => router.push('/members/new')} /> : null}
      </View>

      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <SearchField value={q} onChange={setQ} placeholder={mt('search')} />
          {wide ? (
            <>
              <View style={{ width: 190 }}>
                <Select label={mt('filterRole')} value={role} onChange={setRole} allowClear placeholder={mt('all')}
                  options={(['student', 'guardian', 'instructor', 'staff', 'admin'] as Role[]).map((r) => ({ value: r, label: t(`roles.${r}`) }))} />
              </View>
              {disciplines.length > 1 ? (
                <View style={{ width: 210 }}>
                  <Select label={mt('discipline')} value={disc} onChange={setDisc} allowClear placeholder={mt('allDisciplines')}
                    options={disciplines.map((d) => ({ value: d.id, label: d.name, color: d.color ?? undefined }))} />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
        <FilterChips label={mt('filterStatus')} value={status} onChange={setStatus}
          options={[{ key: 'active', label: mt('st_active') }, { key: 'pending', label: mt('st_pending') }, { key: 'inactive', label: mt('st_inactive') }, { key: 'all', label: mt('all') }]} />
        {!wide ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Select label={mt('filterRole')} value={role} onChange={setRole} allowClear placeholder={mt('all')}
                options={(['student', 'guardian', 'instructor', 'staff', 'admin'] as Role[]).map((r) => ({ value: r, label: t(`roles.${r}`) }))} />
            </View>
            {disciplines.length > 1 ? (
              <View style={{ flex: 1 }}>
                <Select label={mt('discipline')} value={disc} onChange={setDisc} allowClear placeholder={mt('all')}
                  options={disciplines.map((d) => ({ value: d.id, label: d.name, color: d.color ?? undefined }))} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {canCreate && limit != null && used >= limit ? (
        <PlanNotice contactEmail={contactEmail}
          text={used > limit ? t('plan.studentsOver', { current: used, limit, plan: planName }) : t('plan.studentsFull', { limit, plan: planName })} />
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card padding={0} style={{ gap: 0, overflow: 'hidden' }}>
        {wide && rows.length ? (
          <>
            <View style={{ flexDirection: 'row', gap: space.md, paddingHorizontal: space.md, paddingVertical: 10, backgroundColor: palette.paper }}>
              <View style={{ width: 40 }} />
              <Text variant="caption" color={palette.ink2} style={{ flex: 2.2 }}>{mt('firstName')}</Text>
              <Text variant="caption" color={palette.ink2} style={{ flex: 1.6 }}>{mt('rank')}</Text>
              <Text variant="caption" color={palette.ink2} style={{ flex: 1.4 }}>{mt('membership')}</Text>
              <Text variant="caption" color={palette.ink2} style={{ flex: 1.1 }}>{mt('tab_attendance')}</Text>
              <View style={{ width: 8 }} />
            </View>
            <Divider />
          </>
        ) : null}
        {loading ? <Loading /> : rows.length === 0 ? (
          filtered ? <EmptyState icon="search" title={mt('noResults')} body={mt('noResultsBody')} />
            : <EmptyState icon="users" title={mt('empty')} body={mt('emptyBody')}
              action={canCreate ? <Button label={mt('newMember')} icon="user-plus" onPress={() => router.push('/members/new')} /> : undefined} />
        ) : rows.map((m, i) => (
          <View key={m.id}>
            {i > 0 ? <Divider /> : null}
            <Row m={m} wide={wide} financial={financial} onPress={() => router.push(`/members/${m.id}`)} />
          </View>
        ))}
      </Card>

      {!loading && rows.length < total ? (
        <View style={{ alignItems: 'center', gap: space.xs }}>
          <Text variant="small" color={palette.ink2}>{mt('showing', { shown: rows.length, total })}</Text>
          <Button label={mt('loadMore')} variant="secondary" loading={more} onPress={() => load(page + 1)} />
        </View>
      ) : null}
      {status === 'pending' && rows.length ? <Badge label={mt('pendingNotice')} tone="warning" /> : null}
    </Screen>
  );
}
