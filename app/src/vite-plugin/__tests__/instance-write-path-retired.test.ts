// @vitest-environment node
// The instance no longer accepts source writes over the dev-server socket
// (retired 2026-10-18). Every editor write reaches the project through the
// token-guarded /__sq/local/* routes (desktop IPC) and the durable journal;
// the socket keeps only its change/error notifications.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { makeMockServer } from '../server/__tests__/mockServer';
// eslint-disable-next-line import/no-relative-packages
// @ts-expect-error plain-JS preview-template plugin, no types
import { sqSourcePlugin, WRITE_BRIDGE_ID } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

type Plugin = {
  configResolved: (c: { root: string }) => void;
  configureServer: (s: unknown) => void;
  load: (id: string) => string | null | undefined;
};

function instance(local: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'sq-retired-'));
  const bridgeJsPath = join(root, 'bridge.js');
  writeFileSync(bridgeJsPath, '');
  const plugin = sqSourcePlugin(local ? { bridgeJsPath } : undefined) as Plugin;
  plugin.configResolved({ root });
  const server = { ...makeMockServer(), config: { root } };
  plugin.configureServer(server);
  return { plugin, server };
}

describe('instance source writes over the dev-server socket are retired', () => {
  it.each([true, false])('registers no sq:write-* socket handler (local=%s)', (local) => {
    const { server } = instance(local);
    const events = server.ws.on.mock.calls.map((call) => String(call[0]));
    expect(events.filter((event) => event.startsWith('sq:write-'))).toEqual([]);
  });

  it('the script served to local pages parses: a `<script>` mentioned in a comment above the tag is not its start', () => {
    // 2026-10-18 → 2026-11-03 every canvas page threw "Unexpected identifier 'to'": the extract began at a comment's <script>.
    const source = String(instance(true).plugin.load(WRITE_BRIDGE_ID));
    expect(source).not.toContain('---');
    expect(() => new Function(source.replace(/import\.meta/g, '({})'))).not.toThrow();
  });

  it('the script served to local pages defines no write helpers and only relays notifications', () => {
    // The plugin serves this component's <script> body as WRITE_BRIDGE_ID (single source).
    const source = String(instance(true).plugin.load(WRITE_BRIDGE_ID));
    expect(source).not.toContain('__SQ_WRITE_');
    expect(source).not.toMatch(/\.send\(/);
    expect(source).toContain('sq:file-changed');
    expect(source).toContain('vite:error');
  });
});
