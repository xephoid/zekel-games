import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/__tests__/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    environment: 'node',
    // A game's screen tests (.test.tsx, under src/glue/) draw with React and need a page.
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    css: false,
    setupFiles: ['./vitest.setup.ts'],
    // The AI search suites are CPU-heavy; two workers keep vitest's worker
    // messages from timing out on small machines.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
