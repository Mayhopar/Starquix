import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cwd } from 'node:process';
import { webcrypto } from 'node:crypto';
import { afterEach, it, expect, vi } from 'vitest';
import { db } from '@/db';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { prepareSourceCommand } from '../commandReceipts';
import { registerSourceMaterializers } from '../sourceMaterialization';
import { materializerRegistry } from '../registry';
import { createMaterializer } from '../materializer';
import { acceptStoredEdit, getDurableProjectState } from '../store';
import * as store from '../store';
import { teardown } from '../../../../node_modules/@astrojs/compiler/dist/browser/index.js';

// Select the REAL package browser entry, as Vite's production resolver does.
// No compiler or transformation behavior is mocked.
vi.mock('@astrojs/compiler', () => import('../../../../node_modules/@astrojs/compiler/dist/browser/index.js'));
afterEach(() => { teardown(); vi.unstubAllGlobals(); });
it('initializes the real browser WASM compiler under jsdom before source preparation', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = readFileSync(createRequire(`${cwd()}/package.json`).resolve('@astrojs/compiler/astro.wasm'));
  const wasmRequests: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    wasmRequests.push(String(url));
    return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
  });
  await db.delete(); await db.open();
  const projectId = 'browser_wasm_preparation';
  let writes = 0;
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (_url, init) => {
    if (init?.method === 'POST') writes++;
    return new Response('<main class="p-2">Title</main>');
  } });
  const prepared = await prepareSourceCommand(projectId, 'browser-prepare', { kind: 'source-batch', payload: {
    payloads: [{ astroSource: 'src/pages/index.astro', overrides: { classOverrides: { 'main-0': 'p-4' } } }], skipped: [],
  } });
  expect(prepared.afterSource).toBe('<main class="p-4">Title</main>');
  expect(wasmRequests).toHaveLength(1); expect(wasmRequests[0]).toContain('astro.wasm');
  expect(writes).toBe(0);
  expect(await db.durableCommandReceipts.get([projectId, 'browser-prepare'])).toMatchObject({ prepared, outcome: null });
});
it('automatically retries a failed real browser compiler initialization and then prepares and writes once', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const bytes = readFileSync(createRequire(`${cwd()}/package.json`).resolve('@astrojs/compiler/astro.wasm'));
  let loads = 0;
  vi.stubGlobal('fetch', async () => {
    if (++loads === 1) throw new TypeError('WASM network unavailable');
    return new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } });
  });
  await db.delete(); await db.open();
  const projectId = 'browser_wasm_retry';
  let source = '<main class="p-2">Title</main>';
  let writes = 0;
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (_url, init) => {
    if (init?.method === 'POST') { writes++; source = JSON.parse(String(init.body)).afterSource; }
    return new Response(source);
  } });
  await acceptStoredEdit({ projectId, operationId: 'wasm-retry', acceptedAt: 1, yjsUpdate: null,
    commands: [{ kind: 'source-batch', payload: { payloads: [{ astroSource: 'src/pages/index.astro',
      overrides: { classOverrides: { 'main-0': 'p-4' } } }], skipped: [] } }] });
  registerSourceMaterializers();
  const retries: Array<() => void> = [];
  const worker = createMaterializer({ store, registry: materializerRegistry,
    scheduleRetry: callback => { retries.push(callback); return () => {}; } });
  const stop = worker.startMaterializer(projectId);
  try {
    await worker.runOnce(projectId);
    expect({ loads, writes, state: await getDurableProjectState(projectId) }).toMatchObject({ loads: 1, writes: 0, state: { acceptedRevision: 1, materializedRevision: 0 } });
    expect(worker.getStatus(projectId).issue).toBeNull();
    expect(retries).toHaveLength(1);
    expect(writes).toBe(0); expect(await db.durableCommandReceipts.count()).toBe(0);
    retries[0](); await worker.runOnce(projectId);
    expect((await getDurableProjectState(projectId)).materializedRevision).toBe(1);
    expect(loads).toBe(2); expect(writes).toBe(1); expect(source).toContain('p-4');
  } finally { stop(); }
});
