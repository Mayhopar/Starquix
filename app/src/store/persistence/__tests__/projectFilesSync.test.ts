import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/db';
import { putProjectFiles, readProjectFiles } from '@/db/projectFiles';
import { pushProjectFiles, pullProjectFiles, fileBlobId, manifestId } from '../projectFilesSync';

const cfg = { url: 'https://sync.test', token: 't' };
const enc = (s: string) => new TextEncoder().encode(s);

/** A fake sync server: id → bytes. */
function fakeServer() {
  const store = new Map<string, Uint8Array>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const id = decodeURIComponent(url.split('/assets/')[1]);
    if (init?.method === 'PUT') { store.set(id, new Uint8Array(init.body as ArrayBuffer | Uint8Array)); return new Response('ok'); }
    const b = store.get(id);
    return b ? new Response(b) : new Response('nf', { status: 404 });
  });
  return store;
}

beforeEach(async () => { await db.delete(); await db.open(); vi.restoreAllMocks(); });

describe('projectFilesSync (files-truth rows over the asset channel)', () => {
  it('A writes → push → B pulls the row; ids are within the server id grammar', async () => {
    const server = fakeServer();
    await putProjectFiles('p', [{ path: 'src/pages/index.astro', content: enc('v1') }]);
    expect(await pushProjectFiles('p', cfg)).toBe(1);
    expect((await db.projectFiles.get('p:src/pages/index.astro'))?.pendingSync).toBeUndefined();
    expect([...server.keys()].every((id) => /^[A-Za-z0-9._-]{1,128}$/.test(id))).toBe(true);
    expect(server.has(fileBlobId('p', 'src/pages/index.astro'))).toBe(true);
    expect(server.has(manifestId('p'))).toBe(true);
    // "device B": empty local store
    await db.projectFiles.clear();
    expect(await pullProjectFiles('p', cfg)).toEqual(['src/pages/index.astro']);
    expect(await readProjectFiles('p')).toEqual({ 'src/pages/index.astro': 'v1' });
    expect((await db.projectFiles.get('p:src/pages/index.astro'))?.pendingSync).toBeUndefined(); // pulled rows are not re-pushed
  });

  it('last-writer-wins: a newer local row is not overwritten by an older remote one', async () => {
    fakeServer();
    await putProjectFiles('p', [{ path: 'a.txt', content: enc('old'), updatedAt: 1000 }]);
    await pushProjectFiles('p', cfg);
    await putProjectFiles('p', [{ path: 'a.txt', content: enc('newer'), updatedAt: 2000 }]);
    expect(await pullProjectFiles('p', cfg)).toEqual([]);
    expect(await readProjectFiles('p')).toEqual({ 'a.txt': 'newer' });
  });

  it('an unacked push keeps the row pending for the next flush', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await putProjectFiles('p', [{ path: 'a.txt', content: enc('x') }]);
    expect(await pushProjectFiles('p', cfg)).toBe(0);
    expect((await db.projectFiles.get('p:a.txt'))?.pendingSync).toBe(1);
  });
});
