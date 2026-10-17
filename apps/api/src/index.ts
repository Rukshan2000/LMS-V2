import { createKnex } from '@lms/db';
import { buildApp } from './app.js';
import { env } from './env.js';
import { memoryMailer, smtpMailer } from './lib/mail.js';

const db = createKnex(env.DATABASE_URL);
const mailer = env.SMTP_HOST
  ? smtpMailer({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      fromName: env.SMTP_FROM_NAME,
      fromEmail: env.SMTP_FROM_EMAIL || env.SMTP_USER,
    })
  : memoryMailer((m) => console.log(`\n[mail] to ${m.to}: ${m.subject}\n${m.text}\n`));
const app = await buildApp({
  db,
  secureCookies: env.NODE_ENV === 'production',
  mailer,
  appUrl: env.APP_URL,
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
