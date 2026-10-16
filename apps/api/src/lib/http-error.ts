export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// One response for "missing" and "not yours" so IDs from other tenants cannot be probed.
export const notFound = () => new HttpError(404, 'not_found', 'Not found');

export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
