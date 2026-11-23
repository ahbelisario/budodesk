import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PublicDojo } from '../api/types';
import { detectDojoSlug } from '../config';
import { hasSavedLanguage, setLanguage } from '../i18n';

/** Marca del dojo para pantallas públicas (por subdominio, ?dojo= o configuración) */
export function usePublicDojo(slugOverride?: string | null) {
  const slug = slugOverride || detectDojoSlug();
  const [dojo, setDojo] = useState<PublicDojo | null>(null);
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    api.public.get<PublicDojo>(`/account/dojos/${encodeURIComponent(slug)}`)
      .then((d) => {
        if (!alive) return;
        setDojo(d);
        if (!hasSavedLanguage()) setLanguage(d.language, false).catch(() => {});
      })
      .catch(() => { if (alive) setDojo(null); });
    return () => { alive = false; };
  }, [slug]);
  return { slug, dojo };
}
