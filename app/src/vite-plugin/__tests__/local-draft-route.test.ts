// @vitest-environment node
/**
 * Seamless canvas Task 1.5: typed-text drafts live in <project>/.sq/drafts/.
 * A draft is a safety net, never a project file: it is not journaled.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdtempSync, readdirSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProjectFsRoutes, createChangeJournal } from '../../../../preview-template/src/plugins/sq-project-fs-routes.js';

let root: string, url: string, server: Server, journal: ReturnType<typeof createChangeJournal>;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'sq-draft-route-'));
  journal = createChangeJournal();
  type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const routes = new Map<string, Handler>();
  registerProjectFsRoutes({ middlewares: { use: (route: string, handler: Handler) => routes.set(route, handler) } }, { resolveRoot: () => root, sqComponentsDir: '', journal });
  server = createServer((req, res) => {
    const handler = routes.get(req.url!.split('?')[0]);
    if (!handler) { res.writeHead(404); res.end(); return; }
    handler(req, res, () => { res.writeHead(404); res.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/__sq/local/draft`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); });

const draft = (over: Record<string, unknown> = {}) => ({ key: 'src/pages/index.astro:6:5', file: 'src/pages/index.astro', sourceVersion: 'v1', markup: 'Hello', page: '/', ...over });
const post = (body: unknown, q = '') => fetch(url + q, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const list = async () => (await (await fetch(url)).json()).drafts as Array<Record<string, unknown>>;
const draftFiles = () => existsSync(join(root, '.sq/drafts')) ? readdirSync(join(root, '.sq/drafts')).filter(f => f.endsWith('.json')) : [];

describe('/__sq/local/draft', () => {
  it('POST → GET roundtrip, never journaled', async () => {
    expect((await post(draft())).status).toBe(200);
    const drafts = await list();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject(draft());
    expect(typeof drafts[0].updatedAt).toBe('number');
    expect(journal.since(0).entries).toEqual([]);
  });

  it('one file per key, last write wins', async () => {
    await post(draft({ markup: 'a' })); await post(draft({ markup: 'ab' }));
    expect(draftFiles()).toHaveLength(1);
    expect((await list())[0].markup).toBe('ab');
  });

  it('DELETE is idempotent', async () => {
    await post(draft());
    const del = () => fetch(`${url}?key=${encodeURIComponent(draft().key as string)}`, { method: 'DELETE' });
    expect((await del()).status).toBe(200);
    expect((await del()).status).toBe(200);
    expect(await list()).toEqual([]);
  });

  it('orphan moves the draft aside: kept on disk, no longer listed; old orphans pruned', async () => {
    await post(draft());
    expect((await post({ key: draft().key }, '?orphan=1')).status).toBe(200);
    expect(await list()).toEqual([]);
    const orphans = readdirSync(join(root, '.sq/drafts/orphaned'));
    expect(orphans).toHaveLength(1);
    const old = new Date(Date.now() - 31 * 24 * 3600 * 1000);
    utimesSync(join(root, '.sq/drafts/orphaned', orphans[0]), old, old);
    await list();
    expect(readdirSync(join(root, '.sq/drafts/orphaned'))).toEqual([]);
  });

  it.each([
    ['file outside src', { file: '../x' }],
    ['non-string key', { key: 1 }],
    ['oversized markup', { markup: 'x'.repeat(1024 * 1024 + 1) }],
  ])('refuses %s', async (_name, over) => {
    expect((await post(draft(over))).status).toBe(400);
    expect(draftFiles()).toEqual([]);
  });

  it('skips unparsable draft files', async () => {
    await post(draft());
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, '.sq/drafts/broken.json'), '{');
    expect(await list()).toHaveLength(1);
  });
});
