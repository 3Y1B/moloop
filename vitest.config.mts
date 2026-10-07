import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Safe default even on a developer's machine with real provider keys configured.
  test: { include: ['src/**/*.test.ts'], exclude: ['src/**/*.live.test.ts'] },
});
