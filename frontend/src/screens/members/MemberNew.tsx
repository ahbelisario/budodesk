/** Alta de un alumno (o instructor/tutor) */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { membersApi, type DisciplineDef } from '../../api/members';
import { ApiError } from '../../api/client';
import type { Role } from '../../api/types';
import { useSession } from '../../session/SessionProvider';
import { useApi } from '../../utils/useApi';
import { errorMessage } from '../../utils/errors';
import { Screen } from '../../ui/Screen';
import { Button, Card, Field, Icon, Notice, Text } from '../../ui/primitives';
import { DateField, FormGrid, Select, SwitchRow } from '../../ui/forms';
import { palette, radius, space } from '../../theme/tokens';
import { t, useLanguage } from '../../i18n';
import { PersonForm, type PersonValue } from './PersonForm';
import { PersonPicker, type PickedPerson } from './PersonPicker';
import { mt } from './bits';

type InitialRank = { key: number; discipline_id: number | null; rank_id: number | null; since_date: string | null };

/** Opciones de grado de una disciplina (agrupadas por programa si hay varios) */
export function rankOptions(d: DisciplineDef | undefined) {
  if (!d) return [];
  const multi = d.tracks.length > 1;
  return d.tracks.flatMap((tr) => tr.ranks.map((r) => ({
    value: r.id, label: r.name, hint: multi ? tr.name : undefined, color: tr.display_style === 'belt' ? r.color : undefined,
  })));
}

export function RoleToggles({ value, onChange, allowed }: { value: Role[]; onChange: (r: Role[]) => void; allowed: Role[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }} accessibilityRole="none">
      {allowed.map((r) => {
        const on = value.includes(r);
        return (
          <Pressable key={r} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
            onPress={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            style={{ height: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
              borderColor: on ? palette.ink : palette.line, backgroundColor: on ? palette.ink : palette.surface }}>
            {on ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
            <Text variant="smallStrong" color={on ? '#FFFFFF' : palette.ink}>{t(`roles.${r}`)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MemberNew() {
  useLanguage();
  const router = useRouter();
  const { hasRole } = useSession();
  const structure = useApi(() => membersApi.structure(), []);
  const disciplines = structure.data ?? [];

  const [person, setPerson] = useState<PersonValue>({ first_name: '' });
  const [roles, setRoles] = useState<Role[]>(['student']);
  const [memberNumber, setMemberNumber] = useState('');
  const [joinedAt, setJoinedAt] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [ranks, setRanks] = useState<InitialRank[]>([]);
  const [guardian, setGuardian] = useState<PickedPerson | null>(null);
  const [relationship, setRelationship] = useState<string | null>(null);
  const [sendAccess, setSendAccess] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const allowedRoles: Role[] = hasRole('admin') ? ['student', 'guardian', 'instructor', 'staff', 'admin'] : ['student', 'guardian', 'instructor'];
  const hasEmail = !!person.email?.trim();
  const isMinor = useMemo(() => {
    if (!person.date_of_birth) return false;
    const dob = new Date(person.date_of_birth);
    const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
    return age < 18;
  }, [person.date_of_birth]);

  async function submit() {
    setError(null); setFieldErrors({});
    const fe: Record<string, string> = {};
    if (!person.first_name?.trim()) fe.first_name = mt('required');
    if (roles.length === 0) fe.roles = mt('required');
    if (Object.keys(fe).length) { setFieldErrors(fe); return; }

    const clean = Object.fromEntries(Object.entries(person).map(([k, v]) => [k, typeof v === 'string' ? (v.trim() || null) : v]).filter(([, v]) => v != null));
    setSaving(true);
    try {
      const created = await membersApi.create({
        ...(clean as PersonValue), first_name: person.first_name!.trim(),
        roles,
        member_number: memberNumber.trim() || null,
        joined_at: joinedAt,
        notes: notes.trim() || null,
        guardian_user_id: guardian?.id,
        guardian_relationship: guardian && relationship ? relationship : undefined,
        initial_ranks: ranks.filter((r) => r.discipline_id && r.rank_id)
          .map((r) => ({ discipline_id: r.discipline_id!, rank_id: r.rank_id!, ...(r.since_date ? { since_date: r.since_date } : {}) })),
        send_access_email: hasEmail && sendAccess,
      });
      router.replace(`/members/${created.id}?created=1` as never);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'ALREADY_MEMBER') setError(mt('alreadyMember'));
        else {
          const det: Record<string, string> = {};
          e.details?.forEach((d) => { det[d.field] = d.message; });
          setFieldErrors(det);
          setError(errorMessage(e));
        }
      } else setError(errorMessage(e));
    } finally { setSaving(false); }
  }

  return (
    <Screen maxWidth={880}>
      <Pressable accessibilityRole="link" onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <Icon name="chevron-left" size={18} color={palette.ink2} /><Text variant="smallStrong" color={palette.ink2}>{mt('back')}</Text>
      </Pressable>
      <View style={{ gap: 4 }}>
        <Text variant="title" accessibilityRole="header">{mt('newTitle')}</Text>
        <Text variant="small" color={palette.ink2} style={{ maxWidth: 640 }}>{mt('newIntro')}</Text>
      </View>

      <Card style={{ gap: space.lg }}>
        <PersonForm value={person} onChange={setPerson} errors={fieldErrors} showEmail
          sections={['person', 'contact', 'emergency']} emailHint={hasEmail ? undefined : mt('needEmail')} />
      </Card>

      <Card style={{ gap: space.md }}>
        <Text variant="bodyStrong" accessibilityRole="header">{mt('sectionDojo')}</Text>
        <View style={{ gap: 6 }}>
          <Text variant="smallStrong">{mt('roles')}</Text>
          <RoleToggles value={roles} onChange={setRoles} allowed={allowedRoles} />
          {fieldErrors.roles ? <Text variant="small" color={palette.danger}>{fieldErrors.roles}</Text> : null}
        </View>
        <FormGrid>
          <Field label={mt('memberNumber')} value={memberNumber} onChangeText={setMemberNumber} />
          <DateField label={mt('joinedAt')} value={joinedAt} onChange={setJoinedAt} />
        </FormGrid>
        <Field label={mt('notes')} value={notes} onChangeText={setNotes} hint={mt('notesHint')} multiline style={{ minHeight: 72, paddingVertical: 12, textAlignVertical: 'top' }} />
      </Card>

      {roles.includes('student') && disciplines.length ? (
        <Card style={{ gap: space.md }}>
          <View style={{ gap: 2 }}>
            <Text variant="bodyStrong" accessibilityRole="header">{mt('sectionRanks')}</Text>
            <Text variant="small" color={palette.ink2}>{mt('sectionRanksHint')}</Text>
          </View>
          {ranks.map((r, i) => {
            const d = disciplines.find((x) => x.id === r.discipline_id);
            const used = ranks.filter((x) => x.key !== r.key).map((x) => x.discipline_id);
            const update = (patch: Partial<InitialRank>) => setRanks(ranks.map((x) => (x.key === r.key ? { ...x, ...patch } : x)));
            return (
              <View key={r.key} style={{ gap: space.sm, paddingTop: i ? space.sm : 0, borderTopWidth: i ? 1 : 0, borderTopColor: palette.lineSoft }}>
                <FormGrid>
                  <Select label={mt('discipline')} value={r.discipline_id} onChange={(v) => update({ discipline_id: v, rank_id: null })}
                    options={disciplines.filter((x) => !used.includes(x.id)).map((x) => ({ value: x.id, label: x.name }))} />
                  <Select label={mt('rank')} value={r.rank_id} onChange={(v) => update({ rank_id: v })} options={rankOptions(d)} disabled={!d} />
                  <DateField label={mt('since')} value={r.since_date} onChange={(v) => update({ since_date: v })} />
                </FormGrid>
                <Button label={mt('removeRank')} size="sm" variant="ghost" icon="trash-2" onPress={() => setRanks(ranks.filter((x) => x.key !== r.key))} style={{ alignSelf: 'flex-start' }} />
              </View>
            );
          })}
          {ranks.length < disciplines.length ? (
            <Button label={mt('addRank')} size="sm" variant="secondary" icon="plus" style={{ alignSelf: 'flex-start' }}
              onPress={() => setRanks([...ranks, { key: Date.now(), discipline_id: disciplines.length === 1 ? disciplines[0].id : null, rank_id: null, since_date: null }])} />
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <View style={{ gap: 2 }}>
          <Text variant="bodyStrong" accessibilityRole="header">{mt('sectionGuardian')}</Text>
          <Text variant="small" color={palette.ink2}>{mt('sectionGuardianHint')}</Text>
        </View>
        {isMinor && !guardian ? <Notice tone="info">{mt('sectionGuardianHint')}</Notice> : null}
        <FormGrid>
          <PersonPicker label={mt('guardian')} value={guardian} onChange={setGuardian} />
          <Select label={mt('relationship')} value={relationship} onChange={setRelationship} disabled={!guardian}
            options={['mother', 'father', 'legal_guardian', 'grandparent', 'other'].map((r) => ({ value: r, label: mt(`rel_${r}`) }))} />
        </FormGrid>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text variant="bodyStrong" accessibilityRole="header">{mt('sectionAccess')}</Text>
        <SwitchRow label={mt('sendAccess')} hint={hasEmail ? mt('sendAccessHint') : mt('needEmail')} value={hasEmail && sendAccess} onChange={setSendAccess} disabled={!hasEmail} />
      </Card>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      <View style={{ flexDirection: 'row', gap: space.sm, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <Button label={t('common.cancel')} variant="secondary" onPress={() => router.back()} />
        <Button label={mt('create')} icon="user-plus" loading={saving} onPress={submit} />
      </View>
    </Screen>
  );
}
