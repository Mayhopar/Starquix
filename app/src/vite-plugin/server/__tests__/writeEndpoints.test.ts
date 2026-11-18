import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, findWsHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

const SRC = `---
---
<section class="p-4">
  <h1 class="text-xl">Title</h1>
</section>
`;

let root: string;
let server: MockServer;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sq-writes-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  file = path.join(root, 'src', 'Page.astro');
  await writeFile(file, SRC, 'utf-8');
  server = configureMockServer(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// data-sq-source locations are 1-based: <h1> sits on line 4
const h1Location = () => ({ file, line: 4, column: 3 });

describe('WS write handlers', () => {
  it('sq:write-classes writes to disk and acks via sq:write-result', async () => {
    const handler = findWsHandler(server, 'sq:write-classes');
    await handler({ sourceLocation: h1Location(), newClasses: 'text-xl font-bold', requestId: 'r1' });
    expect(await readFile(file, 'utf-8')).toContain('font-bold');
    expect(server.ws.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sq:write-result',
        data: { requestId: 'r1', success: true },
      }),
    );
  });

  it('sq:write-classes acks failure with the error for a missing file', async () => {
    const handler = findWsHandler(server, 'sq:write-classes');
    await handler({
      sourceLocation: { file: path.join(root, 'nope.astro'), line: 1, column: 1 },
      newClasses: 'x', requestId: 'r2',
    });
    expect(server.ws.send).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sq:write-result',
        data: expect.objectContaining({ requestId: 'r2', success: false }),
      }),
    );
  });

  it('a failed write leaves NO unhandled rejection behind', async () => {
    // Regression: queueFileWrite chained cleanup via `newQueue.finally(...)`,
    // creating a derived promise that re-rejects with nobody attached — a
    // failed write (e.g. ENOENT) then surfaced as a process-level
    // unhandledRejection AFTER the test finished, failing the suite with
    // "1 error" intermittently (visible only when the rejection landed
    // post-teardown, i.e. under load / in the pre-push hook).
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => { seen.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      const handler = findWsHandler(server, 'sq:write-classes');
      await handler({
        sourceLocation: { file: path.join(root, 'nope.astro'), line: 1, column: 1 },
        newClasses: 'x', requestId: 'r-ur',
      });
      // Unhandled rejections are detected at end-of-turn — give the loop
      // two macrotask ticks so a floating chain would surface here, inside
      // our listener, instead of after the suite.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(seen).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('sq:write-text writes text content to disk', async () => {
    const handler = findWsHandler(server, 'sq:write-text');
    await handler({ sourceLocation: h1Location(), newText: 'Hello', requestId: 'r3' });
    expect(await readFile(file, 'utf-8')).toContain('Hello');
  });
});

describe('HTTP POST write fallbacks', () => {
  it('POST /__sq/write-classes writes to disk and returns success', async () => {
    const handler = findRouteHandler(server, '/__sq/write-classes');
    const captured = makeCapturedResponse();
    await handler(
      makeJsonRequest('POST', { sourceLocation: h1Location(), newClasses: 'text-xl underline' }),
      captured.res, () => {},
    );
    await captured.done;
    expect((captured.json() as { success: boolean }).success).toBe(true);
    expect(await readFile(file, 'utf-8')).toContain('underline');
  });

  it('non-POST falls through to next()', async () => {
    const handler = findRouteHandler(server, '/__sq/write-classes');
    let nextCalled = false;
    const captured = makeCapturedResponse();
    await handler(makeJsonRequest('GET'), captured.res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
