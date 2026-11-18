/**
 * Seamless canvas (plan 2026-10-04 Task 4.3, case 24): a template error keeps
 * the last good canvas; the editor shows ONE inline status naming the file,
 * cleared by the next good render (SOURCE_OK) or a new document.
 */
import type { ViewportMessageContext } from './context';
import { noteSourceChanged } from '@/services/agentCanvasActivity';

export interface SourceErrorStatus { file: string; line: number | null; message: string }

export function handleSourceError(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as Partial<SourceErrorStatus> | null;
  if (!p) return;
  ctx.actions.setSourceError({ file: typeof p.file === 'string' ? p.file : '', line: typeof p.line === 'number' ? p.line : null,
    message: typeof p.message === 'string' ? p.message : '' });
}

export function handleSourceOk(ctx: ViewportMessageContext): void {
  ctx.actions.setSourceError(null);
  // A source refresh just painted: anything held "until the page shows it" may go (Canvas draw landing).
  window.dispatchEvent(new Event(SOURCE_REFRESHED_EVENT));
}

export const SOURCE_REFRESHED_EVENT = 'sq:source-refreshed';

/** What a source refresh changed; the agent store decides if it was the agent's
 *  (docs/plans/2026-11-10-agent-canvas-flash-design.md). */
export function handleSourceChanged(ctx: ViewportMessageContext, payload: unknown): void {
  const keys = (payload as { keys?: unknown } | null)?.keys;
  if (!ctx.env.projectId || !Array.isArray(keys)) return;
  noteSourceChanged(ctx.env.projectId, keys.filter((k): k is string => typeof k === 'string'));
}

/** The file is the one fact the user acts on. No line: Astro reports the
 *  line of its COMPILED module (measured: 25 for a source error on line 6). */
export function sourceErrorDetail(e: SourceErrorStatus): string {
  return e.file || e.message;
}
