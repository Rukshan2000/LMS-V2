import path from 'node:path';
import type { NextConfig } from 'next';

const monorepoRoot = path.join(__dirname, '../../');

const nextConfig: NextConfig = {
  // Docker image ships .next/standalone only (see apps/web/Dockerfile).
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: monorepoRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  // Local dev only: forward /api to the API on :4000. In production nginx routes /api.
  async rewrites() {
    return process.env.NODE_ENV === 'development'
      ? [{ source: '/api/:path*', destination: 'http://127.0.0.1:4000/api/:path*' }]
      : [];
  },
};

export default nextConfig;
