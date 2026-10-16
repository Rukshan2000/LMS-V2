import { buildApp } from './app.js';
import { env } from './env.js';

const app = buildApp();

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
