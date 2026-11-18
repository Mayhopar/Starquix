// task-122: set_component_category tool — move a library component into/out of
// an Assets folder. Retargeted 2026-08-09: it writes the folder MANIFEST
// (/__sq/folders), not an @category tag; /__sq/set-component-category is gone.
// The tool's name and schema shape are unchanged for the model.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { commandRegistry } from '../commandRegistry';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import type { FolderManifest } from '@/store/folderManifest';

const lib = [
  { name: 'Hero', path: 'library/Hero.astro', category: 'Uncategorized', html: '<div/>' } as unknown as ScannedComponent,
];

const EMPTY: FolderManifest = { version: 1, roots: [], folders: {} };

/** GET returns `manifest`, POST returns ok. Captures every call. */
function stubFetch(manifest: FolderManifest = EMPTY, postOk = true) {
  const fn = vi.fn(async (url: unknown, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      return (postOk
        ? { ok: true, json: async () => ({ success: true }) }
        : { ok: false, status: 500, json: async () => ({ error: 'disk full' }) }) as unknown as Response;
    }
    return { ok: true, json: async () => manifest } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** The manifest body of the POST call, or null if none was made. */
function postedManifest(fn: ReturnType<typeof stubFetch>): FolderManifest | null {
  const call = fn.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === 'POST');
  if (!call) return null;
  return JSON.parse((call[1] as unknown as { body: string }).body).manifest;
}

describe('set_component_category tool (task-122)', () => {
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it('schema requires componentPath; category nullable', () => {
    expect(commandRegistry.set_component_category.schema.safeParse({}).success).toBe(false);
    expect(commandRegistry.set_component_category.schema.safeParse({ componentPath: 'library/Hero.astro', category: 'Marketing' }).success).toBe(true);
    expect(commandRegistry.set_component_category.schema.safeParse({ componentPath: 'library/Hero.astro', category: null }).success).toBe(true);
  });

  it('creates the folder and writes the component into it (resolves by name too)', async () => {
    const fn = stubFetch();
    const tools = generateCommandTools(makeCtx({ componentLibrary: lib }));
    const r = await (tools.set_component_category as ExecTool).execute({ componentPath: 'Hero', category: 'Marketing' });
    expect(r.success).toBe(true);

    const next = postedManifest(fn)!;
    const folder = Object.values(next.folders).find((f) => f.name === 'Marketing');
    expect(folder?.children).toEqual(['comp:library/Hero.astro']);
    expect(fn.mock.calls[0][0]).toBe('/__sq/folders');
  });

  // The @category regex used to truncate at the first word; the manifest holds
  // the whole name, so multi-word folders now work end to end.
  it('accepts a multi-word folder name', async () => {
    const fn = stubFetch();
    const tools = generateCommandTools(makeCtx({ componentLibrary: lib }));
    const r = await (tools.set_component_category as ExecTool).execute({ componentPath: 'Hero', category: 'Marketing pages' });
    expect(r.success).toBe(true);
    expect(Object.values(postedManifest(fn)!.folders).some((f) => f.name === 'Marketing pages')).toBe(true);
  });

  it('reuses an existing folder of the same name instead of duplicating it', async () => {
    const existing: FolderManifest = {
      version: 1,
      roots: ['f_m'],
      folders: { f_m: { name: 'Marketing', children: [] } },
    };
    const fn = stubFetch(existing);
    const tools = generateCommandTools(makeCtx({ componentLibrary: lib }));
    await (tools.set_component_category as ExecTool).execute({ componentPath: 'Hero', category: 'Marketing' });

    const next = postedManifest(fn)!;
    expect(Object.values(next.folders).filter((f) => f.name === 'Marketing')).toHaveLength(1);
    expect(next.folders.f_m.children).toEqual(['comp:library/Hero.astro']);
  });

  it('category null = uncategorize: the component is pinned at the root', async () => {
    const existing: FolderManifest = {
      version: 1,
      roots: ['f_m'],
      folders: { f_m: { name: 'Marketing', children: ['comp:library/Hero.astro'] } },
    };
    const fn = stubFetch(existing);
    const tools = generateCommandTools(makeCtx({ componentLibrary: lib }));
    const r = await (tools.set_component_category as ExecTool).execute({ componentPath: 'library/Hero.astro', category: null });
    expect(r.success).toBe(true);

    const next = postedManifest(fn)!;
    expect(next.folders.f_m.children).toEqual([]);
    expect(next.roots).toContain('comp:library/Hero.astro');
  });

  it('unknown component → failure listing available, no fetch', async () => {
    const fn = stubFetch();
    const tools = generateCommandTools(makeCtx({ componentLibrary: lib }));
    const r = await (tools.set_component_category as ExecTool).execute({ componentPath: 'Nope', category: 'X' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not found/i);
    expect(r.message).toContain('library/Hero.astro');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a failed write surfaces as success:false', async () => {
    stubFetch(EMPTY, false);
    const tools = generateCommandTools(makeCtx({ componentLibrary: lib }));
    const r = await (tools.set_component_category as ExecTool).execute({ componentPath: 'Hero', category: 'Marketing' });
    expect(r.success).toBe(false);
  });
});
