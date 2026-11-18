// ONE builder for ToolExecutionContext — used by the chat agent (useAIAgent)
// and the MCP session (src/mcp). Parity rule: never build a second ctx by
// hand; a hand-rolled ctx drifts the moment the interface grows.
import type { ToolExecutionContext } from './commandTools';
import type { EditorDispatch } from '@/store/durableDispatch';

/** Everything the ctx carries verbatim, plus the two things the builder wraps. */
export type ToolCtxDeps = Omit<ToolExecutionContext, 'dispatch' | 'takeSnapshot' | 'history'> & {
  /** The raw store dispatch; the ctx wraps it with the once-per-batch snapshot + origin 'ai'. */
  dispatch: (command: Parameters<EditorDispatch>[0], origin: 'ai') => ReturnType<EditorDispatch>;
  takeSnapshot: ToolExecutionContext['takeSnapshot'];
  history: Omit<ToolExecutionContext['history'], 'hasMutatedThisBatch'>;
};

/** Once-per-batch snapshot state. The chat keeps ONE guard across a run
 *  (continue-run = same undo unit); the MCP session builds a fresh ctx (and
 *  guard) per call, so every agent call is its own undo step. */
export interface BatchGuard {
  hasMutated: () => boolean;
  markMutated: () => void;
  reset: () => void;
}

export function createBatchGuard(): BatchGuard {
  let taken = false;
  return { hasMutated: () => taken, markMutated: () => { taken = true; }, reset: () => { taken = false; } };
}

/** Builds the ctx over a batch guard: the first mutating call snapshots, later
 *  ones don't, until `batch.reset()`. Pass an existing guard to keep the batch
 *  across rebuilds (the chat rebuilds the ctx per submit). */
export function buildToolCtx(d: ToolCtxDeps, batch: BatchGuard = createBatchGuard()): { ctx: ToolExecutionContext; batch: BatchGuard } {
  const dispatch: EditorDispatch = async (command) => {
    if (!batch.hasMutated()) { d.takeSnapshot(); batch.markMutated(); }
    // origin 'ai': exempt from the undo fold-detector warning (see UndoContext)
    return (await d.dispatch(command, 'ai')) !== false;
  };
  const ctx: ToolExecutionContext = {
    ...d,
    dispatch,
    takeSnapshot: (asset, commandType, defer) => {
      if (batch.hasMutated()) return;
      const commit = d.takeSnapshot(asset, commandType, defer);
      if (defer) return () => {
        if (batch.hasMutated()) return;
        commit?.();
        batch.markMutated();
      };
      batch.markMutated();
    },
    history: { ...d.history, hasMutatedThisBatch: batch.hasMutated },
  };
  return { ctx, batch };
}
