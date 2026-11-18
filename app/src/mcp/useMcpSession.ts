// React glue for McpSession: pulls the SAME hooks useAIAgent pulls, builds the
// ctx through buildToolCtx (parity) per request from live refs, and mirrors
// each call into the chat's activity feed. Mounted by McpProvider only while
// a pairing code is stored.
import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useEditorDoc } from '@/store';
import { useUndoContext } from '@/context/UndoContext';
import { useScannedElementsRef, useSelectionRefs } from '@/context/SelectionContext';
import { useLayoutLibrary } from '@/hooks/useLayoutLibrary';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { useAI } from '@/ai/AIContext';
import { resolveImageGen } from '@/ai/imageGen';
import { desktopDriver } from '@/services/desktopDriver';
import { awaitJournaledFiles } from '@/services/durableEdits/sourceMaterialization';
import { buildToolCtx } from '@/ai/tools/buildToolCtx';
import { formatToolCallAction } from '@/ai/hooks/useAIAgent';
import { buildCatalogue } from './catalogue';
import { McpSession, type McpCallReport, type McpStatus, type SocketLike } from './session';

export interface McpSessionHostOptions {
  code: string;
  projectId: string;
  projectName: string;
  componentLibrary?: ScannedComponent[];
  getCurrentPageFile?: () => string | null;
  onStatus: (s: McpStatus) => void;
  onCall: (r: McpCallReport) => void;
  /** Tests inject a fake socket; production dials a real loopback WebSocket. */
  makeSocket?: (url: string) => SocketLike;
}

const realSocket = (url: string) => new WebSocket(url) as unknown as SocketLike;

export function useMcpSession(opts: McpSessionHostOptions): void {
  const { code, projectId, makeSocket = realSocket } = opts;
  const doc = useEditorDoc();
  const dispatch = useDispatch();
  const { takeSnapshot, claimSnapshot, undo, redo, canUndo, canRedo, pushStructuralUndo } = useUndoContext();
  const { layouts } = useLayoutLibrary();
  const { scannedElementsRef } = useScannedElementsRef();
  const { selectedKeyRef } = useSelectionRefs();
  const { config, addMessage } = useAI();

  // Live ref: a call may arrive minutes after the last render. Everything the
  // catalogue reads goes through it so getCatalogue never changes identity —
  // an identity change would tear the session down mid-pairing.
  const deps = { opts, dispatch, takeSnapshot, claimSnapshot, undo, redo, canUndo, canRedo, pushStructuralUndo, layouts, config, addMessage, scannedElementsRef, selectedKeyRef };
  const live = useRef(deps);
  live.current = deps;

  const getCatalogue = useCallback(() => {
    const l = live.current;
    const { ctx } = buildToolCtx({
      doc,
      dispatch: l.dispatch,
      claimSnapshot: l.claimSnapshot,
      takeSnapshot: l.takeSnapshot,
      selectedElementKey: l.selectedKeyRef.current,
      getScannedElements: () => l.scannedElementsRef.current,
      getCurrentPageFile: l.opts.getCurrentPageFile ?? (() => null),
      pushStructuralUndo: l.pushStructuralUndo,
      availability: {
        hasPexelsKey: Boolean(l.config?.pexelsApiKey),
        hasImageGen: resolveImageGen(l.config ?? null) !== null,
      },
      componentLibrary: l.opts.componentLibrary ?? [],
      layoutLibrary: l.layouts,
      history: { undo: l.undo, redo: l.redo, canUndo: () => l.canUndo, canRedo: () => l.canRedo },
    });
    return buildCatalogue(ctx, { projectId, projectName: l.opts.projectName });
  }, [doc, projectId]);

  const onCall = useCallback((r: McpCallReport) => {
    live.current.opts.onCall(r);
    // Mirror into the chat feed so the user sees what the agent did.
    live.current.addMessage({
      id: `mcp-${r.id}`,
      role: 'assistant',
      content: '',
      timestamp: r.at,
      status: 'complete',
      activities: [{
        id: `mcp-${r.id}-a0`,
        toolName: r.name,
        label: formatToolCallAction(r.name, r.args),
        status: r.ok ? 'done' : 'error',
        detail: r.ok ? 'via MCP' : r.error,
        startedAt: r.at,
      }],
    });
  }, []);

  useEffect(() => {
    const session = new McpSession({
      code,
      projectId,
      projectName: live.current.opts.projectName,
      makeSocket,
      getCatalogue,
      // Files are truth: materialize the accepted edit into the instance AND
      // pull the change journal into Dexie, so read_file after a write sees
      // the write (saveAll alone stops at the instance — live-proven 2026-09-20).
      flush: () => awaitJournaledFiles(projectId, { agent: true }),   // an agent call never commits the user's typed draft
      isReady: async () => {
        const s = await desktopDriver.status();
        return s?.status === 'running' ? { ready: true } : { ready: false, reason: s?.error ?? s?.status ?? 'idle' };
      },
      onStatus: s => live.current.opts.onStatus(s),
      onCall,
    });
    session.connect();
    return () => session.close();
  }, [code, projectId, makeSocket, getCatalogue, onCall]);
}
