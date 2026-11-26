/**
 * Registro público de un dojo nuevo. La solicitud queda pendiente: el superadmin la
 * aprueba y entonces se crea el dojo en prueba gratis (ver backend/modules/signup).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Link, useLocalSearchParams } from 'expo-router';
import { signupApi, type SignupConfig, type SlugStatus } from '../../api/signup';
import { dojoHost } from '../../config';
import { AuthLayout } from '../../ui/AuthLayout';
import { Button, Field, Loading, Notice, Text } from '../../ui/primitives';
import { FormGrid, Select, SwitchRow } from '../../ui/forms';
import { palette } from '../../theme/tokens';
import { getLanguage, t, useLanguage } from '../../i18n';
import { errorMessage } from '../../utils/errors';

const st = (k: string, o?: Record<string, unknown>) => t(`signup.${k}`, o);

const COUNTRIES: Record<string, { currency: string; tz: string }> = {
  MX: { currency: 'MXN', tz: 'America/Mexico_City' },
  US: { currency: 'USD', tz: 'America/New_York' },
  ES: { currency: 'EUR', tz: 'Europe/Madrid' },
  CO: { currency: 'COP', tz: 'America/Bogota' },
  AR: { currency: 'ARS', tz: 'America/Argentina/Buenos_Aires' },
  CL: { currency: 'CLP', tz: 'America/Santiago' },
  PE: { currency: 'PEN', tz: 'America/Lima' },
  OTHER: { currency: 'USD', tz: 'America/Mexico_City' },
};
const TIMEZONES = ['America/Mexico_City', 'America/Monterrey', 'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan',
  'America/Tijuana', 'America/Cancun', 'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Madrid'];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

type Form = {
  dojo_name: string; slug: string; city: string; country: string; timezone: string; disciplines: string; students: string;
  first_name: string; last_name: string; email: string; phone: string; message: string; consent: boolean; website: string;
};

export function DojoSignupScreen() {
  useLanguage();
  // ?from=prueba123: alguien entró a prueba123.budodesk.com y ese dojo no existe
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromSlug = typeof from === 'string' && SLUG_RE.test(from) ? from : null;
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [v, setV] = useState<Form>(() => {
    const tz = browserTz();
    return {
      dojo_name: '', city: '', country: 'MX', timezone: tz && TIMEZONES.includes(tz) ? tz : 'America/Mexico_City',
      disciplines: '', students: '', first_name: '', last_name: '', email: '', phone: '', message: '', consent: false, website: '',
      slug: fromSlug ?? '',
    };
  });
  const [slugTouched, setSlugTouched] = useState(!!fromSlug);
  const [slug, setSlug] = useState<{ checking: boolean; status: SlugStatus | null }>({ checking: false, status: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    signupApi.config().then(setConfig).catch((e) => setConfigError(errorMessage(e)));
  }, []);

  // Revisa la dirección mientras se escribe (con una pausa para no consultar en cada tecla)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!SLUG_RE.test(v.slug)) { setSlug({ checking: false, status: null }); return undefined; }
    setSlug({ checking: true, status: null });
    timer.current = setTimeout(() => {
      signupApi.slug(v.slug).then((status) => setSlug({ checking: false, status }))
        .catch(() => setSlug({ checking: false, status: null }));
    }, 400);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [v.slug]);

  const set = <K extends keyof Form>(k: K) => (x: Form[K]) => setV((o) => ({ ...o, [k]: x }));
  const onName = (dojo_name: string) => setV((o) => ({ ...o, dojo_name, slug: slugTouched ? o.slug : slugify(dojo_name) }));
  // Al cambiar de país se sugiere su zona horaria (México tiene varias: se respeta la elegida)
  const MX_ZONES = TIMEZONES.slice(0, 7);
  const onCountry = (country: string) => setV((o) => {
    const keepTz = country === 'OTHER' || (country === 'MX' && MX_ZONES.includes(o.timezone));
    return { ...o, country, timezone: keepTz ? o.timezone : COUNTRIES[country]?.tz ?? o.timezone };
  });

  const tzOptions = useMemo(() => [...new Set([v.timezone, ...TIMEZONES])].map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), [v.timezone]);
  const countryOptions = Object.keys(COUNTRIES).map((c) => ({ value: c, label: st(`countries.${c}`) }));

  const host = v.slug ? dojoHost(v.slug) : '';
  let slugHint: string | undefined;
  let slugError: string | null = null;
  if (v.slug && !SLUG_RE.test(v.slug)) slugError = st('slug_invalid');
  else if (slug.checking) slugHint = st('slugChecking');
  else if (slug.status?.available) slugHint = st('slugFree', { url: host });
  else if (slug.status && !slug.status.available) slugError = st(`slug_${slug.status.reason ?? 'taken'}`);
  else if (v.slug) slugHint = st('f_slugHint', { url: host });

  // Lo que falta, en palabras (el botón no se deshabilita: al presionarlo dice qué completar)
  const missing = [
    v.dojo_name.trim().length < 2 && st('f_dojoName'),
    !SLUG_RE.test(v.slug) && st('f_slug'),
    !v.first_name.trim() && st('f_firstName'),
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) && st('f_email'),
    !v.consent && st('consentShort'),
  ].filter(Boolean) as string[];
  const [tried, setTried] = useState(false);

  async function submit() {
    setTried(true);
    if (missing.length) { setError(st('missing', { fields: missing.join(', ') })); return; }
    if (slug.status && !slug.status.available) { setError(slugError); return; }
    setBusy(true); setError(null);
    try {
      const n = Number(v.students);
      await signupApi.submit({
        dojo_name: v.dojo_name.trim(), slug: v.slug, first_name: v.first_name.trim(), last_name: v.last_name.trim() || undefined,
        email: v.email.trim(), phone: v.phone.trim() || undefined, city: v.city.trim() || undefined,
        country_code: v.country === 'OTHER' ? 'XX' : v.country, timezone: v.timezone,
        currency: COUNTRIES[v.country]?.currency ?? 'USD', language: getLanguage(),
        disciplines: v.disciplines.trim() || undefined, students_estimate: v.students && Number.isFinite(n) ? Math.round(n) : undefined,
        message: v.message.trim() || undefined, terms_accepted: true, website: v.website || undefined,
      });
      setSent(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const layout = (children: React.ReactNode) => (
    <AuthLayout headline={st('headline')} tagline={st('tagline')} maxWidth={560}>{children}</AuthLayout>
  );

  if (!config && !configError) return layout(<Loading />);
  if (configError) return layout(<Notice tone="danger">{configError}</Notice>);
  if (!config!.enabled) {
    return layout(
      <>
        {fromSlug ? <Notice tone="info">{st('fromUnknownClosed', { url: dojoHost(fromSlug) })}</Notice> : null}
        <Text variant="title" accessibilityRole="header">{st('title')}</Text>
        <Notice tone="info">{st('closed')}</Notice>
        <SignInLink />
      </>,
    );
  }
  if (sent) {
    return layout(
      <>
        <Text variant="title" accessibilityRole="header">{st('sentTitle')}</Text>
        <Notice tone="success">{st('sentBody', { name: v.first_name.trim(), dojo: v.dojo_name.trim(), email: v.email.trim() })}</Notice>
        <Text variant="small" color={palette.ink2}>{st('sentSpam')}</Text>
        <SignInLink />
      </>,
    );
  }

  return layout(
    <>
      {fromSlug ? <Notice tone="info">{st('fromUnknown', { url: dojoHost(fromSlug) })}</Notice> : null}
      <View style={{ gap: 6 }}>
        <Text variant="title" accessibilityRole="header">{st('title')}</Text>
        <Text color={palette.ink2}>{config!.trial_days ? st('subtitle', { days: config!.trial_days }) : st('subtitleNoDays')}</Text>
      </View>

      <Text variant="bodyStrong">{st('s_dojo')}</Text>
      <Field label={`${st('f_dojoName')} *`} value={v.dojo_name} onChangeText={onName} maxLength={255} autoComplete="organization" />
      <Field label={`${st('f_slug')} *`} value={v.slug} autoCapitalize="none" autoCorrect={false} maxLength={40}
        onChangeText={(x) => { setSlugTouched(true); set('slug')(slugify(x)); }}
        hint={slugError ? undefined : slugHint} error={slugError} />
      <FormGrid>
        <Field label={st('f_city')} value={v.city} onChangeText={set('city')} maxLength={100} />
        <Select label={st('f_country')} value={v.country} onChange={(x) => x && onCountry(x)} options={countryOptions} />
        <Select label={st('f_timezone')} value={v.timezone} onChange={(x) => x && set('timezone')(x)} options={tzOptions} />
        <Field label={st('f_students')} value={v.students} onChangeText={(x) => set('students')(x.replace(/\D/g, '').slice(0, 5))}
          keyboardType="number-pad" />
      </FormGrid>
      <Field label={st('f_disciplines')} value={v.disciplines} onChangeText={set('disciplines')} placeholder={st('f_disciplinesPh')} maxLength={255} />

      <Text variant="bodyStrong">{st('s_you')}</Text>
      <FormGrid>
        <Field label={`${st('f_firstName')} *`} value={v.first_name} onChangeText={set('first_name')} autoComplete="given-name" maxLength={100} />
        <Field label={st('f_lastName')} value={v.last_name} onChangeText={set('last_name')} autoComplete="family-name" maxLength={100} />
        <Field label={`${st('f_email')} *`} value={v.email} onChangeText={set('email')} autoCapitalize="none" autoCorrect={false}
          autoComplete="email" keyboardType="email-address" maxLength={150} hint={st('f_emailHint')} />
        <Field label={st('f_phone')} value={v.phone} onChangeText={set('phone')} autoComplete="tel" keyboardType="phone-pad" maxLength={50} />
      </FormGrid>

      <Text variant="bodyStrong">{st('s_more')}</Text>
      <Field label={st('f_message')} value={v.message} onChangeText={set('message')} placeholder={st('f_messagePh')}
        multiline numberOfLines={3} maxLength={2000} style={{ minHeight: 88, textAlignVertical: 'top', paddingTop: 12 }} />
      {/* Trampa para bots: invisible para las personas */}
      <View style={{ position: 'absolute', left: -10000, width: 1, height: 1, overflow: 'hidden' }} aria-hidden>
        <Field label="Website" value={v.website} onChangeText={set('website')} tabIndex={-1} autoComplete="off" />
      </View>

      <View style={tried && !v.consent ? { borderWidth: 1, borderColor: palette.danger, borderRadius: 12, padding: 8 } : undefined}>
        <SwitchRow label={`${st('consent')} *`} value={v.consent} onChange={(x) => { set('consent')(x); if (error) setError(null); }} />
      </View>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={st('submit')} onPress={submit} loading={busy} fullWidth />
      <SignInLink />
    </>,
  );
}

function SignInLink() {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
      <Text variant="small" color={palette.ink2}>{st('haveAccount')}</Text>
      <Link href="/login"><Text variant="smallStrong" style={{ textDecorationLine: 'underline' }}>{t('auth.signIn')}</Text></Link>
    </View>
  );
}
