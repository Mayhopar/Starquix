import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installDesktopConfig } from '../src/wrapper.mjs';
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
it('isolates caches and creates a fallback without importing user config', async () => {
  for (const name of ['one', 'two']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `sq-${name}-`)); roots.push(root);
    await fs.mkdir(path.join(root, '.sq'), { recursive: true });
    await fs.writeFile(path.join(root, 'astro.config.ts'), 'throw new Error("broken")');
    const configs = await installDesktopConfig(root);
    const normal = await fs.readFile(configs.normal, 'utf8');
    const fallback = await fs.readFile(configs.fallback, 'utf8');
    expect(normal).toContain("'../astro.config.ts'");
    expect(normal).toContain("new URL('./cache/astro/', import.meta.url)");
    expect(normal).toContain("new URL('./cache/vite/', import.meta.url)");
    expect(normal).toContain('strictPort: true');
    expect(normal).toContain("'**/.sq/drafts/**'");
    expect(normal).toContain('overlay: false');
    expect(fallback).not.toContain('../astro.config');
    expect(await fs.readFile(path.join(root, 'astro.config.ts'), 'utf8')).toBe('throw new Error("broken")');
  }
});
// Security (audit 2026-10-18): `cors: true` (a WebContainer leftover) let any
// website the user visited read the project from its loopback instance. Only
// the editor reads it cross-origin (loadPostViewHtml's direct fetch).
it('allows only the editor origin cross-origin', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-cors-')); roots.push(root);
  const configs = await installDesktopConfig(root);
  for (const file of [configs.normal, configs.fallback]) {
    const config = await fs.readFile(file, 'utf8');
    expect(config).not.toMatch(/cors:\s*true/);
    expect(config).toContain('cors: { origin: [process.env.SQ_EDITOR_ORIGIN].filter(Boolean) }');
  }
});
