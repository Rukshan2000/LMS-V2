import { z } from 'zod';

/** Every email address is stored and compared lower-cased. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
