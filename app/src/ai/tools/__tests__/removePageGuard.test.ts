// Finding 20 (2026-08-12 adversarial review): AI remove_page routed to
// deleteLocalDocPage with NO structural guard — the page-file delete could
// interleave with an in-flight span write to the same file (the writer's
// read→splice→write would resurrect the deleted file, or the delete's undo
// entry would hold pre-write content). The local remove_page branch now
// acquires/releases THE shared structural write guard around the delete.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/store/localPages', () => ({
  createLocalDocPage: vi.fn(),
  deleteLocalDocPage: vi.fn(),
}));
vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});

import { deleteLocalDocPage } from '@/store/localPages';
import { markFilesTruth, filesTruthPath } from '@/utils/localMode';
import {
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
  _resetStructuralWriteInFlightForTests,
} from '@/components/Editor/localStructuralOps';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import * as Y from 'yjs';

const mockDelete = deleteLocalDocPage as ReturnType<typeof vi.fn>;

const LOCAL_ID = 'browser_lf_my-astro-site';
const LOCAL_PATH = filesTruthPath(LOCAL_ID);

function localCtx() {
  const ctx = makeCtx({ currentPageId: 'about' });
  ctx.doc.getMap('meta').set('projectId', LOCAL_ID);
  const page = new Y.Map();
  page.set('id', 'about');
  ctx.doc.getMap('pages').set('about', page);
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetStructuralWriteInFlightForTests();
  localStorage.clear();
  markFilesTruth(LOCAL_ID);
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  _resetStructuralWriteInFlightForTests();
});

describe('remove_page (local) takes the shared structural write guard (finding 20)', () => {
  // Owner 2026-11-10: no "retry in a moment" — it waits its turn; the file
  // delete still never races the span write.
  it('a structural span write in flight → the page delete waits its turn (never races it), then runs', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true); // simulate in-flight span write
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const pending = (tools.remove_page as ExecTool).execute({ pageId: 'about' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDelete).not.toHaveBeenCalled();
    releaseStructuralWrite();
    expect((await pending).success).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it('acquires and RELEASES the guard around a successful delete', async () => {
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.remove_page as ExecTool).execute({ pageId: 'about' });
    expect(result.success).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith(ctx.doc, LOCAL_PATH, 'about', ctx.pushStructuralUndo, expect.any(Function));
    // Guard must be free again — a leaked lock would refuse every later write.
    expect(tryAcquireStructuralWrite()).toBe(true);
    releaseStructuralWrite();
  });

  it('releases the guard when the delete endpoint refuses', async () => {
    mockDelete.mockRejectedValue(new Error('This is the last page — a site needs at least one.'));
    const ctx = localCtx();
    const tools = generateCommandTools(ctx);
    const result = await (tools.remove_page as ExecTool).execute({ pageId: 'about' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('last page');
    expect(tryAcquireStructuralWrite()).toBe(true);
    releaseStructuralWrite();
  });
});
