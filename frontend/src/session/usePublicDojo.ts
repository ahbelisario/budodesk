import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { PublicDojo } from '../api/types';
import { detectDojoSlug, redirectUnknownDojo, slugFromHost } from '../config';
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
      .catch((e) => {
        if (!alive) return;
        setDojo(null);
        // Subdominio que no es de ningún dojo: a budodesk.com/signup (no aplica a ?dojo= ni a local)
        if (e instanceof ApiError && e.status === 404 && !slugOverride && slug === slugFromHost()) redirectUnknownDojo(slug);
      });
    return () => { alive = false; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  return { slug, dojo };
}
