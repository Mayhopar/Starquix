// /__sq/folders (built-in library) and /__sq/local/folders (user project):
// read + replace the folder manifest. Whole-file writes, last-write-wins.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

let base: string;
let root: string;
let userDir: string;
let server: MockServer;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sq-folders-'));
  root = path.join(base, 'app');
  userDir = path.join(base, 'their-site');
  await mkdir(path.join(base, 'preview-template', 'src', 'components', 'library'), { recursive: true });
  await mkdir(root, { recursive: true });
  await mkdir(path.join(userDir, 'src'), { recursive: true });
  server = configureMockServer(root);
});

afterEach(async () => { await rm(base, { recursive: true, force: true }); });

async function call(route: string, method: 'GET' | 'POST', body?: unknown, query = '') {
  const handler = findRouteHandler(server, route);
  const captured = makeCapturedResponse();
  await handler(makeJsonRequest(method, body, `${route}${query}`), captured.res, () => {});
  await captured.done;
  return captured;
}

const MANIFEST = { version: 1, roots: ['f_1'], folders: { f_1: { name: 'Marketing pages', children: [] } } };

describe('/__sq/folders (built-in)', () => {
  it('returns an empty manifest when the file is absent', async () => {
    const res = await call('/__sq/folders', 'GET');
    expect(res.json()).toEqual({ version: 1, roots: [], folders: {} });
  });

  it('round-trips a manifest', async () => {
    await call('/__sq/folders', 'POST', { manifest: MANIFEST });
    const res = await call('/__sq/folders', 'GET');
    expect(res.json()).toEqual(MANIFEST);
  });

  it('preserves a multi-word folder name', async () => {
    await call('/__sq/folders', 'POST', { manifest: MANIFEST });
    const onDisk = await readFile(
      path.join(base, 'preview-template', 'src', 'components', 'library', '.sq-folders.json'),
      'utf-8',
    );
    expect(JSON.parse(onDisk).folders.f_1.name).toBe('Marketing pages');
  });
});

describe('/__sq/local/folders', () => {
  it('returns an empty manifest for a project with no manifest yet', async () => {
    const res = await call('/__sq/local/folders', 'GET', undefined, `?path=${encodeURIComponent(userDir)}`);
    expect(res.json()).toEqual({ version: 1, roots: [], folders: {} });
  });

  it('writes .starquix/folders.json inside the project and reads it back', async () => {
    await call('/__sq/local/folders', 'POST', { path: userDir, manifest: MANIFEST });
    const onDisk = await readFile(path.join(userDir, '.starquix', 'folders.json'), 'utf-8');
    expect(JSON.parse(onDisk)).toEqual(MANIFEST);
    const res = await call('/__sq/local/folders', 'GET', undefined, `?path=${encodeURIComponent(userDir)}`);
    expect(res.json()).toEqual(MANIFEST);
  });

  it('refuses an unknown project folder', async () => {
    const res = await call('/__sq/local/folders', 'POST', { path: path.join(base, 'nope'), manifest: MANIFEST });
    expect(res.status()).toBe(400);
  });
});


describe.each(['local', 'built-in'] as const)('%s folder read failure preserves source', mode => {
  const destination = () => mode === 'local' ? path.join(userDir, '.starquix', 'folders.json')
    : path.join(base, 'preview-template', 'src', 'components', 'library', '.sq-folders.json');
  const read = () => mode === 'local'
    ? call('/__sq/local/folders', 'GET', undefined, `?path=${encodeURIComponent(userDir)}`)
    : call('/__sq/folders', 'GET');
  it('returns an unavailable response for malformed JSON without changing its bytes', async () => {
    const file = destination(); const original = '{"version":1,"roots":["f_kept"],"folders":{"f_kept":{"name":"Recoverable folder"';
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, original);
    const response = await read();
    expect(response.status()).toBe(500);
    expect(await readFile(file, 'utf8')).toBe(original);
  });
  it('does not present a directory as an empty manifest', async () => {
    const file = destination(); await mkdir(file, { recursive: true });
    const response = await read();
    expect(response.status()).toBe(500);
  });
  it('does not present a blocked parent path as a missing optional file', async () => {
    const file = destination(); const parent = path.dirname(file);
    await rm(parent, { recursive: true, force: true }); await writeFile(parent, 'not a directory');
    const response = await read();
    expect(response.status()).toBe(500);
    expect(await readFile(parent, 'utf8')).toBe('not a directory');
  });
});
