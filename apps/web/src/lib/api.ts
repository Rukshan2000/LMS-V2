import type { Dictionary } from '@/i18n/dictionaries/en';

export type Role = 'owner' | 'admin' | 'teacher' | 'receptionist' | 'student' | 'parent';
export interface User {
  id: string;
  phone: string;
  fullName: string;
}
export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
}
export interface Me {
  user: User;
  tenants: TenantSummary[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Browser-side call to the API. Same origin, so the HttpOnly session cookie is sent automatically. */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = res.status === 429 ? 'rate_limited' : (data.code ?? 'generic');
    throw new ApiError(res.status, code, data.message ?? res.statusText);
  }
  return data as T;
}

export function errorMessage(t: Dictionary, err: unknown): string {
  const code = err instanceof ApiError ? err.code : 'generic';
  return (t.errors as Record<string, string>)[code] ?? t.errors.generic;
}
