// One mapping from session state → what the user sees, shared by the footer
// model pill and AI Settings → MCP, so the light and the settings never disagree.
import React from 'react';
import { cx } from '@/components/ui';
import type { McpSessionState, McpStatus } from './session';

export type McpTone = 'success' | 'warning' | 'error' | 'muted';

export interface McpStatusView { label: string; tone: McpTone; pulse: boolean }

const VIEW: Record<McpSessionState, McpStatusView> = {
  off: { label: 'Not set up', tone: 'muted', pulse: false },
  waiting: { label: 'Waiting for agent', tone: 'muted', pulse: false },
  connecting: { label: 'Connecting', tone: 'warning', pulse: true },
  connected: { label: 'Connected', tone: 'success', pulse: false },
  disconnected: { label: 'Reconnecting', tone: 'warning', pulse: true },
  replaced: { label: 'Taken over by another tab', tone: 'muted', pulse: false },
};

export function mcpStatusView(state: McpSessionState, error?: string): McpStatusView {
  // A refusal (wrong/stale code) is an error the user must act on, not a retry.
  if (state === 'disconnected' && error) return { label: 'Refused', tone: 'error', pulse: false };
  return VIEW[state];
}

const TONE_DOT: Record<McpTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  muted: 'bg-text-muted',
};

/** The MCP light: a status dot for a session status. While an agent is at
 *  work (agent multiplayer, ledger G) it pulses in the AI overlay color. */
export function McpDot({ status, agent = false }: { status: McpStatus; agent?: boolean }): React.ReactElement {
  const view = mcpStatusView(status.state, status.error);
  return <span data-testid="mcp-light" data-state={agent ? 'agent' : status.state}
    className={cx('w-2 h-2 rounded-full shrink-0', agent ? 'bg-overlay-ai animate-pulse' : TONE_DOT[view.tone], !agent && view.pulse && 'animate-pulse')} />;
}
