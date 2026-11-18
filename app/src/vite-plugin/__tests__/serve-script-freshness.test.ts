/**
 * task-141 regression: the local instance's serveScript middleware must serve
 * a REGENERATED bridge.js without an instance restart. The old process-lifetime
 * cache shipped a stale bridge past every fix (live smoke: un-resolve kept
 * failing in a long-running instance because the fixed bridge never loaded).
 * Imports THE plugin (single source, parity law).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
// eslint-disable-next-line import/no-relative-packages
import { sqSourcePlugin } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

function mockServer() {
  const handlers = new Map<string, (req: unknown, res: unknown) => void>();
  return {
    handlers,
    server: {
      middlewares: { use: (route: string, fn: (req: unknown, res: unknown) => void) => handlers.set(route, fn) },
      ws: { on: () => {}, send: () => {} },
      watcher: { on: () => {} },
      config: { root: tmpdir() },
    },
  };
}

function serve(handler: (req: unknown, res: unknown) => void): string {
  let body = '';
  const res = {
    setHeader: () => {},
    end: (b: Buffer | string) => { body = b.toString(); },
  };
  handler({ url: '/' }, res);
  return body;
}

describe('serveScript freshness', () => {
  it('serves regenerated bridge.js bytes without a restart (mtime-fresh cache)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-bridge-'));
    const bridgePath = join(dir, 'bridge.js');
    writeFileSync(bridgePath, '// v1');
    utimesSync(bridgePath, new Date(1000000), new Date(1000000));
    writeFileSync(join(dir, 'tailwind.js'), '// tw');

    const plugin = sqSourcePlugin({ bridgeJsPath: bridgePath }) as {
      configureServer: (s: unknown) => void;
    };
    const { handlers, server } = mockServer();
    plugin.configureServer(server);

    const handler = handlers.get('/scripts/bridge.js');
    expect(handler).toBeTruthy();
    expect(serve(handler!)).toBe('// v1');

    // Regenerate the bridge (new bytes, new mtime) — next request must serve v2
    writeFileSync(bridgePath, '// v2');
    utimesSync(bridgePath, new Date(2000000), new Date(2000000));
    expect(serve(handler!)).toBe('// v2');
  });
});
