// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProjectFsRoutes } from '../../../../preview-template/src/plugins/sq-project-fs-routes.js';
vi.mock('@/utils/localMode', () => ({ findLocalProjectEntry: () => ({ path: '/project' }), isLocalProjectId: () => true, PROJECT_NOT_READY: 'missing project' }));
import { uploadLocalAssetFile, rebindLocalBoundAsset, repointLocalBoundAsset, postComponentDefaultImage } from '../imageUpload';
import { setLocalTransport, resetLocalTransportForTests } from '../sqLocalBase';
let dir: string; let server: Server; let base: string; let loseReply = false;
let project = 0;
let outcomes: Array<string | null> = [];
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sq-receipt-')); project++; outcomes = [];
  mkdirSync(join(dir, 'src', 'components'), { recursive: true });
  mkdirSync(join(dir, 'src', 'content', 'blog'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse, next: () => void) => void>();
  registerProjectFsRoutes({ middlewares: { use: (path: string, handler: never) => { routes.set(path, handler); } } } as never, { resolveRoot: () => dir, sqComponentsDir: dir });
  server = createServer((req, res) => { const handler = routes.get(req.url!.split('?')[0]); if (handler) handler(req, res, () => { res.statusCode = 404; res.end(); }); else { res.statusCode = 404; res.end(); } });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  setLocalTransport({ fetch: async (path, init) => {
    const response = await fetch(base + path, init);
    if (init?.method === 'POST') outcomes.push(response.headers.get('x-sq-mutation-outcome'));
    if (loseReply && init?.method === 'POST') { loseReply = false; throw new TypeError('lost ACK'); }
    return response;
  } });
});
afterEach(async () => { resetLocalTransportForTests(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); });
it('actual upload owner retries a lost ACK with the recorded src, without another suffixed asset', async () => {
  const id = `browser_upload_${project}`; const file = new File(['exact bytes'], 'hero.png'); loseReply = true;
  await expect(uploadLocalAssetFile(id, file)).rejects.toThrow('lost ACK');
  const result = await uploadLocalAssetFile(id, new File(['exact bytes'], 'hero.png'));
  expect(result.src).toBe('/uploads/hero.png');
  expect(readdirSync(join(dir, 'public', 'uploads'))).toEqual(['hero.png']);
});
it('actual rebind owner retries a proven unchanged failure after its missing target is repaired', async () => {
  const id = `browser_upload_${project}`; const file = new File(['replacement'], 'new.png');
  await expect(rebindLocalBoundAsset(id, 'src/content/blog/old.png', file)).rejects.toThrow();
  writeFileSync(join(dir, 'src/content/blog/old.png'), 'old');
  writeFileSync(join(dir, 'src/content/blog/post.md'), '---\nimage: ./old.png\n---\nText');
  const result = await rebindLocalBoundAsset(id, 'src/content/blog/old.png', file);
  expect(result.newAsset).toBe('src/content/blog/new.png');
});
it('body-less repoint retry after lost ACK replays its original undo handle without applying twice', async () => {
  const id = `browser_upload_${project}`;
  writeFileSync(join(dir, 'src/content/blog/a.png'), 'a'); writeFileSync(join(dir, 'src/content/blog/b.png'), 'b');
  writeFileSync(join(dir, 'src/content/blog/post.md'), '---\nimage: ./a.png\n---\nText'); loseReply = true;
  await expect(repointLocalBoundAsset(id, 'src/content/blog/a.png', 'src/content/blog/b.png')).rejects.toThrow('lost ACK');
  await expect(repointLocalBoundAsset(id, 'src/content/blog/a.png', 'src/content/blog/b.png')).resolves.toBeUndefined();
  expect(readFileSync(join(dir, 'src/content/blog/post.md'), 'utf8')).toContain('./b.png');
});
it('default-image owner retry preserves the previous asset from its first successful operation', async () => {
  writeFileSync(join(dir, 'src/components/Card.astro'), "---\nimport __sqDefault_image from '../assets/old.png';\nconst { image = __sqDefault_image } = Astro.props;\n---\n<img src={image} />"); loseReply = true;
  await expect(postComponentDefaultImage('/project', 'src/components/Card.astro', 0, { clear: true })).rejects.toThrow('lost ACK');
  const result = await postComponentDefaultImage('/project', 'src/components/Card.astro', 0, { clear: true });
  expect(result.previous).toBe('src/assets/old.png');
});
it('concurrent duplicate receipts return one recorded asset and reject reuse for different bytes', async () => {
  const { session } = await (await fetch(base + '/__sq/local/mutation-session')).json();
  const headers = { 'x-sq-mutation-session': session, 'x-sq-mutation-id': 'concurrent-attempt' };
  const request = () => fetch(base + '/__sq/local/asset?name=parallel.png', { method: 'POST', headers, body: 'same' });
  const results = await Promise.all([request(), request()]);
  expect(await results[0].json()).toEqual(await results[1].json());
  expect(readdirSync(join(dir, 'public/uploads'))).toEqual(['parallel.png']);
  expect((await fetch(base + '/__sq/local/asset?name=parallel.png', { method: 'POST', headers, body: 'different' })).status).toBe(409);
});
it('an expired runtime receipt epoch never falls back to creating another asset', async () => {
  const response = await fetch(base + '/__sq/local/asset?name=expired.png', { method: 'POST', headers: { 'x-sq-mutation-session': 'previous-runtime', 'x-sq-mutation-id': 'attempt' }, body: 'bytes' });
  expect(response.status).toBe(409);
  expect(response.headers.get('x-sq-mutation-outcome')).toBeNull();
  expect(readdirSync(join(dir, 'public'))).toEqual([]);
});
it('binary rebind and default-image retries preserve the first outcome after lost ACK', async () => {
  const id = `browser_upload_${project}`;
  writeFileSync(join(dir, 'src/content/blog/old.png'), 'old');
  writeFileSync(join(dir, 'src/content/blog/post.md'), '---\nimage: ./old.png\n---\nText');
  const file = new File(['replacement'], 'new.png'); loseReply = true;
  await expect(rebindLocalBoundAsset(id, 'src/content/blog/old.png', file)).rejects.toThrow('lost ACK');
  expect((await rebindLocalBoundAsset(id, 'src/content/blog/old.png', file)).newAsset).toBe('src/content/blog/new.png');
  writeFileSync(join(dir, 'src/components/Card.astro'), '---\nconst { image } = Astro.props;\n---\n<img src={image} />'); loseReply = true;
  await expect(postComponentDefaultImage('/project', 'src/components/Card.astro', 0, { file })).rejects.toThrow('lost ACK');
  expect((await postComponentDefaultImage('/project', 'src/components/Card.astro', 0, { file })).asset).toBe('src/assets/sq-defaults/new.png');
  expect(readdirSync(join(dir, 'src/assets/sq-defaults'))).toEqual(['new.png']);
});
it('partial default-image failure remains blocked until its created bytes are verifiably rolled back', async () => {
  const { unlinkSync } = await import('node:fs');
  writeFileSync(join(dir, 'src/components/Broken.astro'), '<div>invalid image target</div>');
  const file = new File(['keep this intent'], 'partial.png');
  await expect(postComponentDefaultImage('/project', 'src/components/Broken.astro', 0, { file })).rejects.toThrow('may be partial');
  expect(outcomes[0]).toBeNull();
  const journal = await (await fetch(base + '/__sq/local/changes?since=0')).json();
  expect(journal.entries).toContainEqual(expect.objectContaining({ file: 'src/assets/sq-defaults/partial.png' }));
  writeFileSync(join(dir, 'src/components/Broken.astro'), '---\nconst { image } = Astro.props;\n---\n<img src={image} />');
  await expect(postComponentDefaultImage('/project', 'src/components/Broken.astro', 0, { file })).rejects.toThrow('may be partial');
  expect(readdirSync(join(dir, 'src/assets/sq-defaults'))).toEqual(['partial.png']);
  // Simulate an explicit user repair. The application never deletes recovery data.
  unlinkSync(join(dir, 'src/assets/sq-defaults/partial.png'));
  expect((await postComponentDefaultImage('/project', 'src/components/Broken.astro', 0, { file })).asset).toBe('src/assets/sq-defaults/partial.png');
});
it('a lost-ACK receipt cannot claim a subsequently missing asset is still saved', async () => {
  const { unlinkSync } = await import('node:fs');
  const file = new File(['exact bytes'], 'removed.png'); loseReply = true;
  const id = `browser_upload_${project}`;
  await expect(uploadLocalAssetFile(id, file)).rejects.toThrow('lost ACK');
  unlinkSync(join(dir, 'public/uploads/removed.png'));
  await expect(uploadLocalAssetFile(id, file)).rejects.toThrow('Acknowledged image bytes changed');
  writeFileSync(join(dir, 'public/uploads/removed.png'), 'exact bytes');
  expect((await uploadLocalAssetFile(id, file)).src).toBe('/uploads/removed.png');
});
it('concurrent owner callers preserve the same failed receipt for a later retry', async () => {
  const id = `browser_upload_${project}`; const file = new File(['concurrent owner'], 'owner.png'); loseReply = true;
  const results = await Promise.allSettled([uploadLocalAssetFile(id, file), uploadLocalAssetFile(id, file)]);
  expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
  expect((await uploadLocalAssetFile(id, file)).src).toBe('/uploads/owner.png');
  expect(readdirSync(join(dir, 'public/uploads'))).toEqual(['owner.png']);
});
it('an unreadable File cannot poison a later readable pick at the same destination', async () => {
  const id = `browser_upload_${project}`;
  const unreadable = new File(['unreadable'], 'retry.png');
  Object.defineProperty(unreadable, 'arrayBuffer', { value: () => Promise.reject(new DOMException('File cannot be read', 'NotReadableError')) });
  await expect(uploadLocalAssetFile(id, unreadable)).rejects.toThrow('File cannot be read');
  expect((await uploadLocalAssetFile(id, new File(['readable'], 'retry.png'))).src).toBe('/uploads/retry.png');
  expect(readdirSync(join(dir, 'public/uploads'))).toEqual(['retry.png']);
});
it('a compressed same-destination replacement safely settles a proven no-write oversized refusal', async () => {
  const id = `browser_upload_${project}`;
  await expect(uploadLocalAssetFile(id, new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'large.png'))).rejects.toThrow('asset too large');
  expect(readdirSync(join(dir, 'public'))).toEqual([]);
  expect(outcomes[0]).toBe('no-write');
  expect((await uploadLocalAssetFile(id, new File(['compressed'], 'large.png'))).src).toBe('/uploads/large.png');
  expect(readFileSync(join(dir, 'public/uploads/large.png'), 'utf8')).toBe('compressed');
});
it('a pending preparation cannot veto a concurrent readable pick', async () => {
  const id = `browser_upload_${project}`;
  let rejectRead!: (error: Error) => void;
  const file = new File(['unreadable'], 'concurrent-read.png');
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise((_, reject) => { rejectRead = reject; }) });
  const first = uploadLocalAssetFile(id, file);
  const corrected = uploadLocalAssetFile(id, new File(['readable'], 'concurrent-read.png'));
  rejectRead(new Error('read failed'));
  await expect(first).rejects.toThrow('read failed');
  expect((await corrected).src).toBe('/uploads/concurrent-read.png');
});
it('different bytes at the same destination cannot waive an unknown lost-ACK operation', async () => {
  const id = `browser_upload_${project}`; loseReply = true;
  await expect(uploadLocalAssetFile(id, new File(['original intent'], 'unknown.png'))).rejects.toThrow('lost ACK');
  await uploadLocalAssetFile(id, new File(['different intent'], 'unknown.png'));
  expect(outcomes).toEqual([null, null]);
  await uploadLocalAssetFile(id, new File(['original intent'], 'unknown.png'));
});
it('a prior no-write refusal cannot waive a later unknown mutation outcome', async () => {
  const id = `browser_upload_${project}`; const file = new File(['original replacement'], 'same.png');
  await expect(rebindLocalBoundAsset(id, 'src/content/blog/old.png', file)).rejects.toThrow('bound asset not found');
  expect(outcomes[0]).toBe('no-write');
  writeFileSync(join(dir, 'src/content/blog/old.png'), 'old');
  writeFileSync(join(dir, 'src/content/blog/post.md'), '---\nimage: ./old.png\n---\nText'); loseReply = true;
  await expect(rebindLocalBoundAsset(id, 'src/content/blog/old.png', file)).rejects.toThrow('lost ACK');
  // Recreate a reference so a different input can genuinely succeed.
  writeFileSync(join(dir, 'src/content/blog/post.md'), '---\nimage: ./old.png\n---\nText');
  await rebindLocalBoundAsset(id, 'src/content/blog/old.png', new File(['different replacement'], 'same.png'));
});
it('a renamed compressed replacement is not blocked by the original proven no-write refusal', async () => {
  const id = `browser_upload_${project}`;
  await expect(uploadLocalAssetFile(id, new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'image.png'))).rejects.toThrow('asset too large');
  expect((await uploadLocalAssetFile(id, new File(['compressed'], 'image-small.png'))).src).toBe('/uploads/image-small.png');
});

it('a real relative upload receipt returns an editor-safe preview of exactly the persisted bytes', async () => {
  const bytes = new Uint8Array([0, 127, 128, 255, 42]);
  const result = await uploadLocalAssetFile(`browser_upload_${project}`, new File([bytes], 'preview.png', { type: 'image/png' }));
  expect(result.src).toBe('/uploads/preview.png');
  expect(result.previewUrl).toBe('data:image/png;base64,AH+A/yo=');
  expect(readFileSync(join(dir, 'public', result.src))).toEqual(Buffer.from(bytes));
});
