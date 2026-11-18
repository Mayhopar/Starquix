import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';
import { getCachedVariablesCSS } from '../variables';

let root: string;
let server: MockServer;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sq-vars-'));
  server = configureMockServer(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function call(route: string, method: string, body?: unknown) {
  const handler = findRouteHandler(server, route);
  const captured = makeCapturedResponse();
  await handler(makeJsonRequest(method, body), captured.res, () => {});
  await captured.done;
  return captured;
}

describe('variables endpoints', () => {
  it('cache-variables-css updates the in-memory cache; get-variables-css serves it', async () => {
    const css = ':root { --brand: #f00; }';
    const post = await call('/__sq/cache-variables-css', 'POST', { css });
    expect((post.json() as { success: boolean }).success).toBe(true);
    expect(getCachedVariablesCSS()).toBe(css);

    const get = await call('/__sq/get-variables-css', 'GET');
    expect(get.body()).toBe(css);
  });

  // Regression (task-174): the disk-write endpoint is DELETED and must stay
  // deleted. Its only caller (`ViteVariablesWriter.sendViaHttp`) was removed in
  // 1d4d6c59; it then sat unused for two months as an unguarded
  // `path.join(body.projectRoot, body.filePath)` write. Variables reach disk in
  // exactly one place — `export/generateAstro.ts` — which also emits the
  // `@import` that makes the file load. Re-adding a bare writer here would
  // create a file nothing imports and nothing reads back.
  it('write-variables is not registered', () => {
    expect(() => findRouteHandler(server, '/__sq/write-variables')).toThrow();
  });

  // Regression (cross-project token leak): a single shared variables.json was
  // written by every project and hydrated into every fresh project's doc.
  // The endpoints must stay deleted — the Yjs doc is the only variables store.
  it('variables-json endpoints are not registered', () => {
    expect(() => findRouteHandler(server, '/__sq/write-variables-json')).toThrow();
    expect(() => findRouteHandler(server, '/__sq/read-variables-json')).toThrow();
  });
});
