/**
 * Iframe lifecycle messages: legacy READY, bridge IFRAME_READY (writer refs,
 * asset transfer, RENDER re-arm), content height, and in-iframe navigation.
 */
import { viteClassWriter } from '@/services/ViteClassWriter';
import { frameUnderstandsIntents, setFrameIntentVersion, unlandedIntents } from '@/services/classIntents';
import { getMaterializationStatus } from '@/services/durableEdits/materializer';
import { armTextDraftRestore } from './textDrafts';
import { viteTextWriter } from '@/services/ViteTextWriter';
import { viteMediaWriter } from '@/services/ViteMediaWriter';
import { viteImageWriter } from '@/services/ViteImageWriter';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { resumeLocalVariablesCss } from '@/services/localVariablesCss';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { findLocalProjectEntry } from '@/utils/localMode';
import { setSiteFonts } from '@/services/siteFonts';
import type { ContentHeightPayload, IframeReadyPayload } from '@/bridge';
import type { ViewportMessageContext } from './context';

export function handleReady(ctx: ViewportMessageContext): void {
  ctx.refs.isReady.current = true;
}

export function handleIframeReady(ctx: ViewportMessageContext, payload?: unknown): void {
  // Set iframe ref on writers — must happen before RENDER fires.
  if (ctx.refs.iframe.current) {
    viteClassWriter.setIframeRef(ctx.refs.iframe.current);
    viteTextWriter.setIframeRef(ctx.refs.iframe.current);
    viteImageWriter.setIframeRef(ctx.refs.iframe.current);
    viteMediaWriter.setIframeRef(ctx.refs.iframe.current);
    viteStructuralWriter.setIframeRef(ctx.refs.iframe.current);
    const frame = ctx.refs.iframe.current;
    const projectId = ctx.env.projectId;
    // This document's bridge says whether it understands class intents; a NEW document holds nothing, so the
    // values still waiting for their file are re-posted (same seq) — the bridge queues them until its first scan.
    setFrameIntentVersion(frame, (payload as IframeReadyPayload | undefined)?.classIntentV);
    if (projectId && frameUnderstandsIntents(frame)) {
      for (const entry of unlandedIntents(projectId, getMaterializationStatus(projectId).materializedRevision)) {
        if (entry.classes === null) continue;
        frame.contentWindow?.postMessage({ type: 'UPDATE_CLASSES', payload: { key: entry.key, classes: entry.classes,
          sourceLocation: entry.sourceLocation, intent: { epoch: entry.epoch, seq: entry.seq, hold: true } } }, '*');
      }
    }
    const projectPath = projectId ? findLocalProjectEntry(projectId)?.path : null;
    if (projectId && projectPath) {
      const isCurrent = () => frame.isConnected && ctx.refs.iframe.current === frame &&
        getActiveSaveProjectId() === projectId && findLocalProjectEntry(projectId)?.path === projectPath &&
        viteStructuralWriter.hasWriteFrame(frame);
      void resumeLocalVariablesCss(projectPath, isCurrent).catch(() => { /* retained for explicit save/retry */ });
    }


    // A real iframe (re)load (server-mode astro dev full-reload after a .astro
    // write, WC snapshot-mirror reload) destroys any in-iframe text-edit
    // session — the bridge's EXIT_EDIT_MODE can never arrive. A stale
    // isEditingText=true blocks every RENDER onto the fresh (empty) shell:
    // blank canvas until a full editor reload. Clear it here.
    if (ctx.refs.isEditingText.current) ctx.actions.exitEditMode();
    // A new document: drafts typed in the previous one are restored on its first scan.
    armTextDraftRestore(ctx);
    ctx.actions.setSourceError(null);



    // isIframeReady is a monotonic GATE (first boot only); the reload EDGE is
    // iframeReloaded — a counter bump that re-fires the RENDER effect and
    // every reload-resend effect (SET_MODE, theme, grid probe). The old
    // false→true re-flip could not signal a reload: both writes coalesced
    // into one React flush and no dep changed, so the fresh empty shell kept
    // the canvas blank (reproduced in server mode, 2026-07-24 — see
    // ViewportFrame iframeReloaded).
    ctx.actions.setIsIframeReady(true);
    ctx.actions.iframeReloaded();
  }
}

/**
 * task-120: ASSETS_OWNED — the bridge's post-ready report of asset ids it
 * already holds. Relayed as a window event; useAssetRehydration diffs it
 * against Dexie and transfers only the missing assets. The last payload is
 * kept so a hook that mounts (or gets its projectId) AFTER the event fired
 * can still rehydrate — the old sq:iframe-ready flow covered this race with
 * an unconditional transfer on mount.
 */
let lastOwnedAssetIds: string[] | null = null;

export function getLastAssetsOwned(): string[] | null {
  return lastOwnedAssetIds;
}

export function handleAssetsOwned(_ctx: ViewportMessageContext, payload: unknown): void {
  const ids = (payload as { ids?: string[] } | null)?.ids ?? [];
  lastOwnedAssetIds = ids;
  window.dispatchEvent(new CustomEvent('sq:assets-owned', { detail: { ids } }));
}

/** FONT_FAMILIES (each scan + any <head> change): the families the page declares — the picker's site fonts. */
export function handleFontFamilies(ctx: ViewportMessageContext, payload: unknown): void {
  setSiteFonts(ctx.env.projectId ?? '', (payload as { fontFamilies?: unknown } | null)?.fontFamilies);
}

export function handleContentHeight(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as ContentHeightPayload;
  if (!p || !Number.isFinite(p.height) || p.height <= 0) return;
  ctx.actions.setContentHeight(p.height, p);
}

export function handlePageChanged(ctx: ViewportMessageContext): void {
  // Iframe navigated internally (user clicked a link in the preview).
  // Clear selection and hover — elements from the previous page are gone.
  ctx.actions.clearSelection();
  ctx.actions.setHoveredRect(null);
}
