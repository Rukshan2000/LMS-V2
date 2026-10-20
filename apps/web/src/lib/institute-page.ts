import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';

// Server-side read of an institute's public page. The browser never calls this: the page is
// rendered on the server (for search engines and link previews) and cached per institute.

/** In production the web and API containers share the compose network; locally the API runs on :4000. */
const API =
  process.env.API_INTERNAL_URL ??
  (process.env.NODE_ENV === 'production' ? 'http://api:4000' : 'http://127.0.0.1:4000');

export interface InstitutePage {
  institute: { slug: string; name: string; theme: string };
  page: {
    tagline: string | null;
    about: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
    mapUrl: string | null;
    facebookUrl: string | null;
    youtubeUrl: string | null;
    tiktokUrl: string | null;
    showFees: boolean;
  };
  classes: {
    name: string;
    subject: string;
    mode: 'physical' | 'online' | 'hybrid';
    teacherName: string | null;
    schedule: { weekday: number; startTime: string; endTime: string }[];
    fees: { kind: 'class' | 'ac' | 'tute'; amount: string }[];
  }[];
}

export const instituteTag = (slug: string) => `institute:${slug}`;

/** null when the institute does not exist, is suspended or has not published its page. */
export async function getInstitutePage(slug: string): Promise<InstitutePage | null> {
  'use cache';
  cacheTag(instituteTag(slug));
  // Saving in Settings expires this at once (refreshInstitutePage); the hour is a fallback.
  cacheLife('hours');
  const res = await fetch(`${API}/api/v1/public/institutes/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`institute page ${slug}: HTTP ${res.status}`);
  return res.json();
}
