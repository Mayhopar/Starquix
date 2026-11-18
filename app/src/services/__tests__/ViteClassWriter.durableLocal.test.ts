// A local (desktop) project's class writes go through the durable journal —
// like text, image and media writes — never through the iframe. The in-page
// write path was retired 2026-10-18 (the grid-placement persist and the class
// journal replay were its last callers).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const durable = vi.hoisted(() => ({
  accept: vi.fn(async () => ({ revision: 7 })),
  flush: vi.fn(async () => {}),
}));
vi.mock('../pendingProjectMutations', () => ({ getActiveSaveProjectId: () => 'browser_local1' }));
vi.mock('../durableEdits/acceptance', () => ({ acceptProjectEdit: durable.accept }));
vi.mock('../durableEdits/sourceMaterialization', () => ({ flushDurableSourceWritesThrough: durable.flush }));
vi.mock('@/utils/localWriteScope', async (orig) => ({
  ...(await orig<typeof import('@/utils/localWriteScope')>()),
  captureLocalWriteOrigin: () => ({ armed: true, pageFile: 'src/pages/index.astro' }),
  isCrossFileAtOrigin: () => false,
}));

import { viteClassWriter } from '../ViteClassWriter';
import { markFilesTruth } from '@/utils/localMode';

markFilesTruth('browser_local1');

describe('ViteClassWriter — local projects', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts an ordinary class write as a durable class-write command and posts nothing to the iframe', async () => {
    const postMessage = vi.fn();
    viteClassWriter.setLocalInstanceState({ status: 'running', url: 'http://127.0.0.1:1' } as never);
    viteClassWriter.setIframeRef({ contentWindow: { postMessage } } as never);
    const loc = { file: 'src/pages/index.astro', line: 3, column: 5 };
    expect(await viteClassWriter.writeClassUpdate(loc, 'a b', false, 'a')).toBe(true);
    expect(postMessage).not.toHaveBeenCalled();
    expect(durable.accept).toHaveBeenCalledTimes(1);
    const [, edit] = durable.accept.mock.calls[0] as unknown as [unknown, { projectId: string; commands: Array<{ kind: string; payload: Record<string, unknown> }> }];
    expect(edit.projectId).toBe('browser_local1');
    expect(edit.commands).toEqual([expect.objectContaining({ kind: 'class-write',
      payload: expect.objectContaining({ sourceLocation: expect.objectContaining(loc), newClasses: 'a b', baseClasses: 'a' }) })]);
    expect(durable.flush).toHaveBeenCalledWith('browser_local1', 7);
  });
});
