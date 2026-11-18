// update_element_by_key on files-truth must never answer "classes updated"
// for an edit that writes no file (2026-10-05: durable rev 53 carried no
// source command — the key was not on the canvas mid-re-render — and the tool
// still reported success).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const writes = vi.hoisted(() => ({ value: true }));
vi.mock('@/utils/localPageSync', async (orig) => ({ ...(await orig<object>()), waitForLocalScan: vi.fn(async () => {}) }));
vi.mock('@/store/commandGesture', async (orig) => ({ ...(await orig<object>()), acceptEditorCommands: vi.fn(async () => {}) }));
vi.mock('@/services/durableEdits/classCommands', async (orig) => ({ ...(await orig<object>()), writesSourceClasses: () => writes.value }));

import { acceptEditorCommands } from '@/store/commandGesture';
import { waitForLocalScan } from '@/utils/localPageSync';
import { markFilesTruth } from '@/utils/localMode';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';

const ID = 'browser_honest';
const KEY = 'src/components/Card.astro:3:1';
const loc = { file: 'src/components/Card.astro', line: 3, column: 1 };

function ctx(scanned: unknown[]) {
  const c = makeCtx({ currentPageId: 'index', getScannedElements: () => scanned as never });
  c.doc.getMap('meta').set('projectId', ID);
  return c;
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); markFilesTruth(ID); writes.value = true; });

describe('update_element_by_key (files-truth honesty)', () => {
  it('a key that is not on the canvas waits for one scan, then fails — nothing accepted', async () => {
    const r = await (generateCommandTools(ctx([])).update_element_by_key as ExecTool).execute({ sourceKey: KEY, classes: 'p-4' });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/not on the current canvas/);
    expect(waitForLocalScan).toHaveBeenCalled();
    expect(acceptEditorCommands).not.toHaveBeenCalled();
  });

  it('an element that arrives with the awaited scan is written', async () => {
    const scanned: unknown[] = [];
    m(waitForLocalScan).mockImplementation(async () => { scanned.push({ key: KEY, tagName: 'div', classes: 'p-2', sourceLocation: loc }); });
    const r = await (generateCommandTools(ctx(scanned)).update_element_by_key as ExecTool).execute({ sourceKey: KEY, classes: 'p-4' });
    expect(r).toMatchObject({ success: true, message: 'classes updated' });
  });

  it('an instance edit from a page says the component file is unchanged', async () => {
    writes.value = false;
    const r = await (generateCommandTools(ctx([{ key: KEY, tagName: 'div', classes: 'p-2', sourceLocation: loc }])).update_element_by_key as ExecTool).execute({ sourceKey: KEY, classes: 'p-4' });
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/override on this page only \(the page passes it as a prop; .*Card\.astro keeps its own value\)/);
  });
});

function m<T>(f: T) { return f as unknown as ReturnType<typeof vi.fn>; }
