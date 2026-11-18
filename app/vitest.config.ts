import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { realpathSync } from 'node:fs';

export default defineConfig({
  // Worktrees share installed packages through node_modules. Browser WASM URL
  // imports must be served from that exact real package directory in tests.
  server: { fs: { allow: [path.resolve(__dirname, '..'), realpathSync(path.resolve(__dirname, 'node_modules'))] } },
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost',
      },
    },
    setupFiles: ['./src/test/setup.ts'],
    // The fuzz / stress tests run 1-2 s alone and 5-10 s while parallel sessions load the machine (load 50+ on 8 cores,
    // 2026-11-10): the 5 s default flipped them in the pre-push gate. Waits have their own budget (src/test/setup.ts).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Node >=25 ships its own global localStorage (undefined without --localstorage-file) that shadows jsdom's:
    // 200+ tests failed on Node 26 (2026-11-08). Node 22 (CI) accepts the flag too.
    execArgv: ['--no-experimental-webstorage'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/test/**', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'virtual:built-in-components': path.resolve(__dirname, './src/test/__mocks__/virtual-built-in-components.ts'),
    },
  },
});
