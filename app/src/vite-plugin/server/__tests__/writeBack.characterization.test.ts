/**
 * Characterization tests for POST /__sq/write-back-component — pinned BEFORE
 * the godfile-decomposition extraction (plan Task B1) so the move is provable.
 *
 * Asserts ON-DISK content, not just the HTTP response (memory:
 * feedback_verify_disk_not_response — endpoints can return OK on skipped writes).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

const COMPONENT_SRC = `---
const x = 1;
---
<section class="p-4">
  <h1 class="text-xl">Title</h1>
  <p>Body</p>
</section>
`;

describe('/__sq/write-back-component (characterization)', () => {
  let root: string;
  let componentPath: string;
  let server: MockServer;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sq-writeback-'));
    await mkdir(path.join(root, 'src', 'components'), { recursive: true });
    componentPath = path.join(root, 'src', 'components', 'Hero.astro');
    await writeFile(componentPath, COMPONENT_SRC, 'utf-8');
    server = configureMockServer(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function post(body: unknown) {
    const handler = findRouteHandler(server, '/__sq/write-back-component');
    const captured = makeCapturedResponse();
    await handler(makeJsonRequest('POST', body), captured.res, () => {});
    await captured.done;
    return captured;
  }

  it('applies classOverrides to the file ON DISK and returns the new content', async () => {
    const r = await post({
      astroSource: componentPath, // absolute paths pass straight through resolveComponentPath
      overrides: { classOverrides: { 'h1-0': 'text-xl font-bold' } },
    });
    expect(r.status()).toBe(200);
    const json = r.json() as { success: boolean; changed: boolean; content: string };
    expect(json.success).toBe(true);
    expect(json.changed).toBe(true);

    const onDisk = await readFile(componentPath, 'utf-8');
    expect(onDisk).toContain('font-bold');
    expect(onDisk).toBe(json.content);
  });

  it('returns OK with changed:false for an unresolvable selector and leaves the disk file untouched (characterization — known behavior, the skip is reported, not an error)', async () => {
    const r = await post({
      astroSource: componentPath,
      overrides: { classOverrides: { 'h1-9': 'font-bold' } },
    });
    expect(r.status()).toBe(200);
    const json = r.json() as {
      success: boolean; changed: boolean;
      report: { skipped: { classes: string[] } };
    };
    expect(json.success).toBe(true);
    expect(json.changed).toBe(false);
    expect(json.report.skipped.classes).toEqual(['h1-9']);

    const onDisk = await readFile(componentPath, 'utf-8');
    expect(onDisk).toBe(COMPONENT_SRC);
  });

  it('refuses deletes that would empty the file body with 422 + refusedSelectors, disk untouched', async () => {
    const r = await post({
      astroSource: componentPath,
      overrides: { deletedSelectors: ['section-0'] },
    });
    expect(r.status()).toBe(422);
    expect((r.json() as { refusedSelectors: string[] }).refusedSelectors).toEqual(['section-0']);
    expect(await readFile(componentPath, 'utf-8')).toBe(COMPONENT_SRC);
  });

  it('rejects non-POST with 405', async () => {
    const handler = findRouteHandler(server, '/__sq/write-back-component');
    const captured = makeCapturedResponse();
    await handler(makeJsonRequest('GET'), captured.res, () => {});
    await captured.done;
    expect(captured.status()).toBe(405);
  });

  it('rejects a missing astroSource with 400', async () => {
    const r = await post({ overrides: {} });
    expect(r.status()).toBe(400);
  });

  it('returns 500 with a JSON error for a nonexistent file', async () => {
    const r = await post({
      astroSource: path.join(root, 'src', 'components', 'Missing.astro'),
      overrides: { classOverrides: { 'h1-0': 'x' } },
    });
    expect(r.status()).toBe(500);
    expect((r.json() as { error: string }).error).toBeTruthy();
  });
});
