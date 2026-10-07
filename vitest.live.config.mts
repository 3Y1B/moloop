import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Explicit opt-in only: npm run test:live. These tests may spend real provider credits. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.live.test.ts'] },
});
