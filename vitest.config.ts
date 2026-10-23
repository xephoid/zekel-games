import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/__tests__/**/*.test.ts', 'packages/*/src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // The AI search suites are CPU-heavy; two workers keep vitest's worker
    // messages from timing out on small machines.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
