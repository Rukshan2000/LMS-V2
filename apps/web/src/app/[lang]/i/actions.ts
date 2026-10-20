'use server';

import { updateTag } from 'next/cache';
import { instituteTag } from '@/lib/institute-page';

/** Called by Settings after saving, so the public page shows the change on the next visit.
 *  Anyone could call it, but all it does is make the next visit re-read the API. */
export async function refreshInstitutePage(slug: string) {
  if (/^[a-z0-9-]{3,60}$/.test(slug)) updateTag(instituteTag(slug));
}
