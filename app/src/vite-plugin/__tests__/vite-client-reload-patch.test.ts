/**
 * Seamless canvas D1: every reload Vite's client can do to the preview frame
 * must ask the bridge first. Runs against the REAL locked client
 * (desktop/runtime-deps), so a Vite bump that changes the shape fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
// @ts-expect-error plain-JS plugin
import { patchViteClient } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

const deps = path.resolve(__dirname, '../../../../desktop/runtime-deps/node_modules');
const req = createRequire(path.join(deps, 'astro/package.json'));
const client = readFileSync(path.join(path.dirname(req.resolve('vite/package.json')), 'dist/client/client.mjs'), 'utf8');

describe('patchViteClient', () => {
  it('routes every location.reload() through the bridge hook', () => {
    const out = patchViteClient(client) as string;
    expect(out).not.toBeNull();
    expect(out.match(/location\.reload\(\)/g)).toHaveLength(1); // only inside __sqReload's fallback
    expect(out).toContain('__sqReload("reconnect")');
    expect(out.split('__sqReload("reload")').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('drops the 20 ms reload debounce (the bridge coalesces refreshes)', () => {
    expect(client).toMatch(/debounceReload\(\d+\)/); // the real client still has one to cut
    const out = patchViteClient(client) as string;
    expect(out).toContain('debounceReload(0)');
    expect(out).not.toMatch(/debounceReload\([1-9]\d*\)/);
  });

  it('fails closed on an unknown client shape', () => {
    expect(patchViteClient('location.reload();')).toBeNull();
  });

  it('the hook claims a reload only by returning true', async () => {
    const src = patchViteClient('await waitForSuccessfulPing(a, b);\n location.reload();') as string;
    const run = (handled: boolean) => {
      const calls: string[] = []; let reloaded = 0;
      const g = { __SQ_VITE_RELOAD__: (r: string) => { calls.push(r); return handled; } };
      const done = new Function('globalThis', 'location', 'waitForSuccessfulPing', 'a', 'b',
        `return (async () => { ${src.replace(/^const /, 'var ')} })()`)(g, { reload: () => { reloaded++; } }, async () => {});
      return done.then(() => ({ calls, reloaded }));
    };
    expect(await run(true)).toEqual({ calls: ['reconnect'], reloaded: 0 });
    expect(await run(false)).toEqual({ calls: ['reconnect'], reloaded: 1 });
  });
});
