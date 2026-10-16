import { createKnex } from '@lms/db';
import { buildApp } from './app.js';
import { env } from './env.js';

const db = createKnex(env.DATABASE_URL);
const app = await buildApp({ db, secureCookies: env.NODE_ENV === 'production' });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    await app.close();
    await db.destroy();
    process.exit(0);
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
