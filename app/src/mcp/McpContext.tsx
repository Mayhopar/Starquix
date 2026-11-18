// Exposes the MCP session (status, code) to the AI settings and the terminal panel's light without prop-drilling.
// Mounted around the Footer in Editor.tsx — under AIProvider, undo, selection, class store — so the session builds the
// exact ToolExecutionContext the chat builds.
//
// Always on (2026-11-08): the chat is the API agent only, and the agents in the Terminal tab and outside drive the
// editor through this session. The provider holds only the pairing code; the session's hooks (layout library fetch,
// AI context, undo…) mount once a code exists — in the desktop app main hands it over at once, elsewhere the MCP
// settings mint it when first shown, so an untouched browser never dials.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useMcpSession, type McpSessionHostOptions } from './useMcpSession';
import type { McpCallReport, McpStatus } from './session';
import { getStoredCode, setStoredCode, takePendingCode } from './codeStore';
import { mintPairingCode } from './protocol';
import { desktopMcp } from './clientSetup';
import { noteAgentActivity } from '@/services/agentPresence';
import { noteAgentWrite } from '@/services/agentCanvasActivity';
import { extractTouchedKey } from '@/ai/utils/activityKeys';

export interface McpContextValue {
  status: McpStatus;
  lastCall: McpCallReport | null;
  /** This project's pairing code. null until main hands it over (desktop) or the MCP settings are first shown —
   *  no code = no session = nothing dials the relay. */
  code: string | null;
  /** Mint a fresh code (the first one, or a replacement that drops the connected agent). */
  newCode: () => void;
}

/** Exported for tests only (see __tests__/mcpTestProvider.tsx); app code uses McpProvider. */
export const McpContext = createContext<McpContextValue | null>(null);

export function useMcp(): McpContextValue {
  const v = useContext(McpContext);
  if (!v) throw new Error('useMcp must be used within an McpProvider');
  return v;
}

/** For chrome that may render outside the editor (Footer tests, other pages): null = no MCP here. */
export function useMcpOptional(): McpContextValue | null {
  return useContext(McpContext);
}

export type McpProviderProps = Omit<McpSessionHostOptions, 'code' | 'onStatus' | 'onCall'> & { children: React.ReactNode };

export function McpProvider({ children, ...opts }: McpProviderProps) {
  const { projectId } = opts;
  // A `?mcp=<code>` from `starquix-mcp pair` becomes this project's code. Desktop: ONE app-wide code from main (the
  // relay's own identity file), so an agent's relay is paired with nothing pasted; it follows relay rewrites.
  const [desktop] = useState(desktopMcp);
  const [code, setCode] = useState<string | null>(() => (desktop ? null : takePendingCode(projectId) ?? getStoredCode(projectId)));
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void desktop.code().then(c => { if (live) setCode(c); }).catch(() => {});
    const off = desktop.onCode(c => { if (live) setCode(c); });
    return () => { live = false; off(); };
  }, [desktop]);
  const [status, setStatus] = useState<McpStatus>({ state: 'off' });
  const [lastCall, setLastCall] = useState<McpCallReport | null>(null);

  const newCode = useCallback(() => {
    if (desktop) { void desktop.rotate().then(setCode).catch(() => {}); return; }
    const next = mintPairingCode();
    setStoredCode(projectId, next);
    setCode(next);
  }, [projectId, desktop]);

  const value = useMemo(() => ({ status, lastCall, code, newCode }), [status, lastCall, code, newCode]);
  // Agent presence (G1): every MCP call is the agent at work, on the file it names.
  const onCall = useCallback((report: McpCallReport) => {
    setLastCall(report);
    const file = [report.args.path, report.args.file].find((v): v is string => typeof v === 'string');
    noteAgentActivity({ projectId, action: report.name, ...(file ? { file } : {}) });
    if (report.ok && report.mutating) { // its canvas changes show as the agent's
      const key = extractTouchedKey(report.name, report.args, report.result);
      noteAgentWrite(projectId, key ? [key] : []);
    }
  }, [projectId]);
  return (
    <McpContext.Provider value={value}>
      {code && <McpSessionHost {...opts} code={code} onStatus={setStatus} onCall={onCall} />}
      {children}
    </McpContext.Provider>
  );
}

function McpSessionHost(opts: McpSessionHostOptions) {
  useMcpSession(opts);
  return null;
}
