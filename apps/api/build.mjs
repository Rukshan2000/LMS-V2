// Bundle the API (and the migration CLI) into dist/. Workspace code (@lms/db, TypeScript)
// is bundled in; npm dependencies stay external and come from node_modules at runtime.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const deps = (file) => Object.keys(JSON.parse(readFileSync(file, 'utf8')).dependencies ?? {});
const external = [...deps('package.json'), ...deps('../../packages/db/package.json')].filter(
  (name) => !name.startsWith('@lms/'),
);

await build({
  entryPoints: { index: 'src/index.ts', migrate: '../../packages/db/src/migrate.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
