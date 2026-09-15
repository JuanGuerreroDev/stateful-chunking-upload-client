import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/adapters/**', 'src/application/**'],
      // Barriles de solo re-export: sin lógica que cubrir.
      exclude: ['src/index.ts', 'src/node.ts', 'src/**/index.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
