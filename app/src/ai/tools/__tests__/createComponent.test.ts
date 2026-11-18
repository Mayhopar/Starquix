// task-121: create_component tool — new library component from HTML markup.
//
// Contract (fdd2d12f): the component file is no longer POSTed to
// /save-component before the doc mutation — the file + the instance are ONE
// durably accepted gesture (acceptFileChanges), materialized to the project
// folder afterwards. Save-first/doc-second survives as "acceptance refused →
// doc untouched, no file".
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { generateCommandTools } from '../commandTools';
import { commandRegistry } from '../commandRegistry';
import { applyCommand } from '@/store/commands';
import { makeCtx, type ExecTool } from './testCtx';

describe('create_component tool (task-121)', () => {
  let projectId: string;
  let runtime: ReturnType<typeof projectFsRuntime>;

  beforeEach(async () => {
    vi.stubGlobal('crypto', webcrypto);
    await db.delete(); await db.open();
    projectId = `browser_cc_${crypto.randomUUID()}`;
    setActiveSaveProjectId(projectId);
    runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main></main>\n' });
  });
  afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  function ctxWithPage() {
    const ctx = makeCtx({ currentPageId: 'page-1' });
    ctx.doc.getMap('meta').set('projectId', projectId);
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
    return ctx;
  }

  it('schema requires name and staticMarkup', () => {
    expect(commandRegistry.create_component.schema.safeParse({}).success).toBe(false);
    expect(commandRegistry.create_component.schema.safeParse({ name: 'FeatureTile', staticMarkup: '<div/>' }).success).toBe(true);
  });

  it('happy path returns componentName + instanceId, mutates the doc and writes the component file', async () => {
    const ctx = ctxWithPage();
    const tools = generateCommandTools(ctx);
    const r = await (tools.create_component as ExecTool).execute({ name: 'Feature Tile', staticMarkup: '<section class="p-4">hi</section>' });
    expect(r.success).toBe(true);
    expect(r.data?.componentName).toBe('FeatureTile');
    expect(ctx.doc.getMap('elements').get(r.data!.instanceId as string)).toBeTruthy();
    await flushDurableSourceWrites(projectId);
    expect(runtime.read('src/components/library/FeatureTile.astro')).toBe('<section class="p-4">hi</section>');
  });

  it('surfaces failures as success:false with the reason — doc untouched, no file', async () => {
    vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota exceeded'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = ctxWithPage();
    const tools = generateCommandTools(ctx);
    const r = await (tools.create_component as ExecTool).execute({ name: 'X', staticMarkup: '<div/>' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/quota exceeded/);
    expect(ctx.doc.getMap('elements').size).toBe(0);
    expect(await db.durableEdits.count()).toBe(0);
    expect(existsSync(join(runtime.root, 'src/components/library/X.astro'))).toBe(false);
  });
});
