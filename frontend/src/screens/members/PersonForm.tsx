/**
 * Formulario de datos de una persona. Lo usan el alta, la edición en la ficha,
 * "Mis datos" y "Mis hijos". Es controlado: recibe el valor y avisa cambios.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { ProfileFields } from '../../api/members';
import { uploadAvatar } from '../../api/members';
import { Avatar, Button, Field, Icon, Notice, Text } from '../../ui/primitives';
import { DateField, FormGrid, Select } from '../../ui/forms';
import { palette, space } from '../../theme/tokens';
import { t } from '../../i18n';
import { errorMessage } from '../../utils/errors';
import { fullName } from '../../utils/format';

export type PersonValue = Partial<ProfileFields> & { email?: string | null };
type Errors = Partial<Record<keyof PersonValue, string | null>>;

const m = (k: string) => t(`members.${k}`);

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ gap: 2 }}>
        <Text variant="bodyStrong" accessibilityRole="header">{title}</Text>
        {hint ? <Text variant="small" color={palette.ink2}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function PersonForm({
  value, onChange, errors = {}, showEmail = false, emailHint, sections = ['person', 'contact', 'emergency', 'address'],
}: {
  value: PersonValue; onChange: (v: PersonValue) => void; errors?: Errors; showEmail?: boolean; emailHint?: string;
  sections?: ('person' | 'contact' | 'emergency' | 'address')[];
}) {
  const set = <K extends keyof PersonValue>(k: K) => (v: PersonValue[K]) => onChange({ ...value, [k]: v });
  const txt = (k: keyof PersonValue) => ({ value: (value[k] as string | null | undefined) ?? '', onChangeText: set(k) as (s: string) => void, error: errors[k] ?? null });

  return (
    <View style={{ gap: space.lg }}>
      {sections.includes('person') ? (
        <Section title={m('sectionPerson')}>
          <FormGrid>
            <Field label={`${m('firstName')} *`} {...txt('first_name')} autoComplete="given-name" />
            <Field label={m('lastName')} {...txt('last_name')} autoComplete="family-name" />
            <Field label={m('secondLastName')} {...txt('second_last_name')} />
            <Field label={m('preferredName')} {...txt('preferred_name')} />
            <DateField label={m('dob')} value={value.date_of_birth} onChange={set('date_of_birth')} error={errors.date_of_birth} />
            <Select label={m('gender')} value={value.gender ?? null} onChange={set('gender')} allowClear
              options={(['female', 'male', 'other', 'undisclosed'] as const).map((g) => ({ value: g, label: m(`g_${g}`) }))} />
          </FormGrid>
        </Section>
      ) : null}

      {sections.includes('contact') ? (
        <Section title={m('sectionContact')}>
          <FormGrid>
            {showEmail ? <Field label={m('email')} {...txt('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" hint={emailHint} /> : null}
            <Field label={m('phone')} {...txt('phone')} keyboardType="phone-pad" autoComplete="tel" />
          </FormGrid>
        </Section>
      ) : null}

      {sections.includes('emergency') ? (
        <Section title={m('sectionEmergency')}>
          <FormGrid>
            <Field label={m('emergencyName')} {...txt('emergency_contact_name')} />
            <Field label={m('emergencyPhone')} {...txt('emergency_contact_phone')} keyboardType="phone-pad" />
            <Field label={m('emergencyRelation')} {...txt('emergency_contact_relation')} />
            <Select label={m('bloodType')} value={value.blood_type ?? null} onChange={set('blood_type')} allowClear
              options={['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((b) => ({ value: b, label: b }))} />
          </FormGrid>
          <Field label={m('medical')} {...txt('medical_notes')} multiline hint={m('medicalHint')}
            style={{ minHeight: 96, paddingVertical: 12, textAlignVertical: 'top' }} />
        </Section>
      ) : null}

      {sections.includes('address') ? (
        <Section title={m('sectionAddress')}>
          <FormGrid>
            <Field label={m('address1')} {...txt('address_line1')} autoComplete="street-address" />
            <Field label={m('address2')} {...txt('address_line2')} />
            <Field label={m('city')} {...txt('city')} />
            <Field label={m('state')} {...txt('state')} />
            <Field label={m('postal')} {...txt('postal_code')} keyboardType="number-pad" autoComplete="postal-code" />
          </FormGrid>
        </Section>
      ) : null}
    </View>
  );
}

/** Foto con botón para cambiarla (sube al servidor en cuanto se elige) */
export function PhotoPicker({ name, photoUrl, userId, onUploaded, size = 72, overlay }: {
  name: string; photoUrl: string | null | undefined; userId?: number; onUploaded: (url: string) => void; size?: number; overlay?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick() {
    setErr(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setErr(m('photoPermission')); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    setBusy(true);
    try {
      const a = res.assets[0];
      const { url } = await uploadAvatar(a.uri, userId, a.mimeType ?? 'image/jpeg');
      onUploaded(url);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (overlay) {
    return (
      <View style={{ gap: 4 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={m('changePhoto')} onPress={pick} disabled={busy} style={{ opacity: busy ? 0.6 : 1 }}>
          <Avatar name={name || '?'} photoUrl={photoUrl} size={size} />
          <View style={{ position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 28, backgroundColor: palette.ink,
            borderWidth: 2, borderColor: palette.paper, alignItems: 'center', justifyContent: 'center' }}>
            {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="camera" size={13} color="#FFFFFF" />}
          </View>
        </Pressable>
        {err ? <Text variant="caption" color={palette.danger} style={{ maxWidth: 120 }}>{err}</Text> : null}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <Avatar name={name || '?'} photoUrl={photoUrl} size={size} />
      <View style={{ gap: 6, flexShrink: 1 }}>
        <Button label={m('changePhoto')} size="sm" variant="secondary" icon="camera" loading={busy} onPress={pick} style={{ alignSelf: 'flex-start' }} />
        {err ? <Notice tone="danger">{err}</Notice> : null}
      </View>
    </View>
  );
}

export const personName = (v: PersonValue) => fullName({ first_name: v.first_name ?? '', last_name: v.last_name, preferred_name: v.preferred_name });
