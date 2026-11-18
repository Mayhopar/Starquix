// Shared ToolExecutionContext factory for ai/tools tests.
// Keep ALL ctx fields here — partial inline mocks break whenever the ctx grows.
import * as Y from 'yjs';
import { vi } from 'vitest';
import type { ToolExecutionContext } from '../commandTools';

export type ExecTool = { execute: (p: unknown) => Promise<{ success: boolean; message?: string; cancelled?: boolean; data?: Record<string, unknown> }> };

export function stubHistory(): ToolExecutionContext['history'] {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: () => true,
    canRedo: () => false,
    hasMutatedThisBatch: () => false,
  };
}

export function makeCtx(
  over: Partial<ToolExecutionContext> & {
    /** Convenience: seeds meta.currentPageId — tools read it live from the doc now. */
    currentPageId?: string | null;
  } = {},
): ToolExecutionContext {
  const { currentPageId, ...rest } = over;
  const doc = rest.doc ?? new Y.Doc();
  if (currentPageId != null) doc.getMap('meta').set('currentPageId', currentPageId);
  return {
    doc,
    dispatch: vi.fn(() => true),
    takeSnapshot: vi.fn(),
    selectedElementKey: null,
    getScannedElements: () => [],
    getCurrentPageFile: () => null,
    pushStructuralUndo: vi.fn(),
    availability: { hasPexelsKey: false, hasImageGen: false },
    componentLibrary: [],
    layoutLibrary: [],
    history: stubHistory(),
    ...rest,
  };
}
