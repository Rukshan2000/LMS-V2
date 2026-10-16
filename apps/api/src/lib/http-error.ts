export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** Extra JSON sent to the client, e.g. the existing record on a duplicate. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// One response for "missing" and "not yours" so IDs from other tenants cannot be probed.
export const notFound = () => new HttpError(404, 'not_found', 'Not found');

export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
