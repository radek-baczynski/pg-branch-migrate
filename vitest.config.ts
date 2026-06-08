import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/upstream-node-pg-migrate/**',
      '**/drizzle-kit-inspect/**',
      '**/drizzle-orm-inspect/**',
    ],
    globals: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
