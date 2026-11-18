// Security (audit 2026-10-18): the instance's /_image route serves ANY
// data:image/svg+xml href as an SVG document on the instance origin — a link
// to it ran attacker script there. The stub placeholder is its only legit use
// (as an <img>, where a sandboxing CSP changes nothing).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// eslint-disable-next-line import/no-relative-packages
import { sqSourcePlugin } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

describe('/_image data-SVG route', () => {
  it('serves the SVG under a script-less sandbox CSP', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-image-'));
    writeFileSync(join(dir, 'bridge.js'), '');
    const handlers = new Map<unknown, (req: unknown, res: unknown, next: () => void) => void>();
    const plugin = sqSourcePlugin({ bridgeJsPath: join(dir, 'bridge.js') }) as { configureServer: (s: unknown) => void };
    plugin.configureServer({
      middlewares: { use: (route: unknown, fn: (req: unknown, res: unknown, next: () => void) => void) => handlers.set(route, fn) },
      ws: { on: () => {}, send: () => {} },
      watcher: { on: () => {} },
      config: { root: tmpdir() },
    });
    const headers: Record<string, string> = {};
    let body = '';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';
    handlers.get('/_image')!(
      { url: `/?href=${encodeURIComponent(`data:image/svg+xml,${encodeURIComponent(svg)}`)}` },
      { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; }, end: (b: string) => { body = b; } },
      () => { throw new Error('a data-SVG href must be answered here'); },
    );
    expect(body).toBe(svg);
    expect(headers['content-type']).toBe('image/svg+xml');
    expect(headers['content-security-policy']).toBe("default-src 'none'; sandbox");
  });
});
