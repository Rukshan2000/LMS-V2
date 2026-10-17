import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().positive().default(4000),
    // Restricted app role only. Migration credentials never reach the running API.
    DATABASE_URL: z.url(),
    // Web base URL, for links in emails.
    APP_URL: z.url().default('http://localhost:3000'),
    // Outgoing email (Gmail: smtp.gmail.com:587 + an App Password). Without SMTP_HOST, local
    // dev prints emails to the console instead; production refuses to start.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_FROM_NAME: z.string().default('Tuition LMS'),
    SMTP_FROM_EMAIL: z.string().default(''),
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.SMTP_HOST, {
    path: ['SMTP_HOST'],
    message: 'required in production',
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
