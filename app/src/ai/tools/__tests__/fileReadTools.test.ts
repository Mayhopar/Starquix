// task-267: the in-editor chat could edit_file / write_file but not read a file
// or list them — its own tool text says "Read it first with read_file". The two
// read tools are registry tools now: ONE implementation for the chat and MCP.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

vi.mock('@/services/durableEdits/sourceMaterialization', async (orig) => ({ ...(await orig<object>()), awaitJournaledFiles: vi.fn(async () => {}) }));

import { db } from '@/db';
import { putProjectFiles } from '@/db/projectFiles';
import { awaitJournaledFiles } from '@/services/durableEdits/sourceMaterialization';
import { buildCatalogue } from '@/mcp/catalogue';
import { generateCommandTools } from '../commandTools';
import { makeCtx } from './testCtx';

const enc = (s: string) => new TextEncoder().encode(s);
type Tools = Record<string, { execute: (args: object) => Promise<unknown> }>;
const chat = () => {
  const ctx = makeCtx();
  ctx.doc.getMap('meta').set('projectId', 'browser_p');
  return { ctx, tools: generateCommandTools(ctx) as unknown as Tools };
};

describe('list_files / read_file in the chat tool set', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await db.projectFiles.clear();
    await putProjectFiles('browser_p', [
      { path: 'src/pages/index.astro', content: enc('---\n---\n<h1>Hi</h1>') },
      { path: 'src/pages/about.astro', content: enc('about') },
      { path: 'public/logo.png', content: new Uint8Array([1, 2, 3]) },
    ]);
    await putProjectFiles('browser_other', [{ path: 'src/pages/index.astro', content: enc('other') }]);
  });

  it('list_files lists only this project, sorted, optionally by prefix', async () => {
    const { tools } = chat();
    expect(await tools.list_files.execute({})).toEqual({ files: ['public/logo.png', 'src/pages/about.astro', 'src/pages/index.astro'] });
    expect(await tools.list_files.execute({ prefix: 'src/pages/' })).toEqual({ files: ['src/pages/about.astro', 'src/pages/index.astro'] });
  });

  it('read_file returns text, refuses binary, reports a missing path', async () => {
    const { tools } = chat();
    expect(await tools.read_file.execute({ path: 'src/pages/index.astro' })).toEqual({ path: 'src/pages/index.astro', content: '---\n---\n<h1>Hi</h1>' });
    expect(await tools.read_file.execute({ path: 'public/logo.png' })).toMatchObject({ success: false, message: expect.stringContaining('binary') });
    expect(await tools.read_file.execute({ path: 'nope.astro' })).toMatchObject({ success: false, message: expect.stringContaining('nope.astro') });
  });

  it('lands accepted edits first, so a read right after a write sees it', async () => {
    const { tools } = chat();
    await tools.read_file.execute({ path: 'src/pages/index.astro' });
    await tools.list_files.execute({});
    expect(vi.mocked(awaitJournaledFiles).mock.calls).toEqual([['browser_p', { agent: true }], ['browser_p', { agent: true }]]); // agent barrier: never pushes the user's typed draft
  });

  it("MCP's read_file and list_files are the same tools: same answers", async () => {
    const { ctx, tools } = chat();
    const { callables } = buildCatalogue(ctx, { projectId: 'browser_p' });
    for (const [name, args] of [['read_file', { path: 'src/pages/about.astro' }], ['list_files', { prefix: 'src/' }]] as const) {
      expect(await callables.get(name)!.execute(args)).toEqual(await tools[name].execute(args));
      expect(callables.get(name)!.mutating).toBe(false);
    }
  });
});
