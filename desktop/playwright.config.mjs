import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', workers: 1, retries: 0, timeout: 300_000,
  reporter: [['line'], ['html', { open: 'never' }]],
  // A packaged app (SQ_E2E_APP) carries its own editor build: no dev server.
  webServer: process.env.SQ_E2E_APP ? undefined : { command: 'npm --prefix ../app run dev -- --host 127.0.0.1 --port 3061 --strictPort',
    url: 'http://127.0.0.1:3061', reuseExistingServer: !!process.env.SQ_REUSE_EDITOR, timeout: 90_000 } });
