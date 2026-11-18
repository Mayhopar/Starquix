/**
 * Pins the /__sq/* endpoint surface BEFORE/DURING the godfile-decomposition
 * extraction (plan Task B2). All routes are distinct connect prefixes, so the
 * sorted inventory must stay IDENTICAL across the whole phase; the only
 * order-sensitive duplicate (the two /__sq/element-source registrations)
 * is pinned by count and relative position.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, type MockServer } from './mockServer';

let root: string;
let server: MockServer;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sq-routes-'));
  server = configureMockServer(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

// The host no longer mounts pick/open/status/stop/stamp-plan/unstamp (the
// host-folder disk was removed 2026-09-10). The /__sq/local/* TABLE below is
// mounted by mockServer.ts for the oracle tests, exactly as the in-instance
// plugin mounts it — so its route set stays pinned here.
describe('sq endpoint registration surface', () => {
  it('registers the pinned set of middleware routes', () => {
    const routes = server.middlewares.use.mock.calls.map(c => c[0] as string);
    expect([...routes].sort()).toEqual([
      '/__sq/cache-variables-css',
      '/__sq/component-html',
      '/__sq/content-collections',
      '/__sq/create-post',
      '/__sq/delete-collection',
      '/__sq/delete-component',
      '/__sq/delete-layout',
      '/__sq/delete-post',
      '/__sq/element-source',
      '/__sq/element-source',
      '/__sq/folders',
      '/__sq/get-variables-css',
      '/__sq/layout-prop',
      '/__sq/local/asset',
      '/__sq/local/asset-file',
      '/__sq/local/assets',
      '/__sq/local/bundled-asset',
      '/__sq/local/changes',
      '/__sq/local/component-create',
      '/__sq/local/component-default-image',
      '/__sq/local/component-delete',
      '/__sq/local/component-promote',
      '/__sq/local/component-rename',
      '/__sq/local/component-usages',
      '/__sq/local/content',
      // Seamless canvas: typed-text drafts in .sq/drafts (never journaled).
      '/__sq/local/draft',
      // Content editor: copies one of OUR components into the user's project on
      // first `/` insert (allowlisted name, never a client-supplied path).
      '/__sq/local/ensure-sq-component',
      '/__sq/local/file',
      '/__sq/local/folders',
      // gap-61 files-truth fonts: bytes → public/fonts/, css marker-merged
      // into public/sq-fonts.css + <link> wired into <head>-owning .astro.
      '/__sq/local/font-css',
      '/__sq/local/font-file',
      // Layout list/create/delete/inline-delete (task-209) are planned here and
      // written by source-command file batches — no direct layout write routes.
      '/__sq/local/layout-plan',
      // Files-truth receipt protocol establishes the runtime mutation session.
      '/__sq/local/mutation-session',
      // Page create/delete/rename/move/restore are planned here and written by
      // source-command file batches (locked, atomic) — no direct write routes.
      '/__sq/local/page-plan',
      // local layout apply: raw page bytes for the whole-file transform + undo
      '/__sq/local/page-source',
      '/__sq/local/pages',
      '/__sq/local/rebind-asset',
      '/__sq/local/scan-components',
      '/__sq/local/scan-layouts',
      '/__sq/local/source-command',
      '/__sq/local/write-file',
      '/__sq/rename-component',
      '/__sq/rename-layout',
      '/__sq/save-component',
      '/__sq/save-layout',
      '/__sq/scan-components',
      '/__sq/scan-layouts',
      '/__sq/snapshot-version',
      '/__sq/update-post',
      '/__sq/write-back-component',
      '/__sq/write-classes',
      '/__sq/write-image',
      '/__sq/write-text',
    ]);
  });

  it('registers /__sq/element-source twice (GET then POST handler) — order is behavior', () => {
    const routes = server.middlewares.use.mock.calls.map(c => c[0] as string);
    const indices = routes
      .map((r, i) => (r === '/__sq/element-source' ? i : -1))
      .filter(i => i !== -1);
    expect(indices).toHaveLength(2);
    // The two registrations must be adjacent (moved as a unit)
    expect(indices[1]).toBe(indices[0] + 1);
  });

  it('registers the pinned set of WS handlers', () => {
    const events = server.ws.on.mock.calls.map(c => c[0] as string);
    expect([...events].sort()).toEqual([
      'sq:reorder-elements',
      'sq:write-classes',
      'sq:write-image',
      'sq:write-text',
    ]);
  });
});
