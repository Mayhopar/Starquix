// @vitest-environment node
import { basename, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';

// Regression: a worktree with app/node_modules symlinked to the main checkout's
// re-optimized deps into the shared node_modules/.vite/deps under the running
// :3000 server → 504 Outdated Optimize Dep → "Starquix needs to recover" (2026-09-23).
describe('vite cacheDir', () => {
  it('is keyed by the checkout directory so sibling worktrees never share a dep cache', () => {
    const cfg = (config as (env: { mode: string; command: 'serve' }) => { cacheDir?: string })({ mode: 'test', command: 'serve' });
    const appDir = resolve(__dirname, '../..');
    const checkout = basename(resolve(appDir, '..'));
    expect(cfg.cacheDir).toBe(resolve(appDir, 'node_modules/.vite', checkout));
  });
});
