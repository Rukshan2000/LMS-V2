import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Locally read ../../.env; in CI the variables come from the workflow.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    fileParallelism: false,
  },
});
