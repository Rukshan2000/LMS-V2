// Bundle the API (and the migration and billing CLIs) into dist/. Workspace code (@lms/db, TypeScript)
// is bundled in; npm dependencies stay external and come from node_modules at runtime.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const deps = (file) => Object.keys(JSON.parse(readFileSync(file, 'utf8')).dependencies ?? {});
const external = [...deps('package.json'), ...deps('../../packages/db/package.json')].filter(
  (name) => !name.startsWith('@lms/'),
);

await build({
  entryPoints: {
    index: 'src/index.ts',
    migrate: '../../packages/db/src/migrate.ts',
    // Temporary billing CLI (docs/runbooks/billing.md); removed with the console in Phase 3.
    billing: 'src/modules/billing/admin-cli.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
