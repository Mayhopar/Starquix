// AI Settings → MCP: one prompt to copy into any coding agent, and the light.
// No per-agent config writes — the prompt pairs the agent and tells it how to
// register the relay in its own MCP settings. Outside the desktop app showing this
// view mints the project's code (first time only) — the session starts dialing
// only then; in the desktop app the code is app-wide and arrives from main.
import React, { useEffect, useState } from 'react';
import { Button, OperationNotice, Row } from '@/components/ui';
import { useMcp } from '@/mcp/McpContext';
import { McpDot, mcpStatusView } from '@/mcp/statusView';
import { desktopMcp, mcpAgentPrompt } from '@/mcp/clientSetup';

export function McpTab(): React.ReactElement {
  const mcp = useMcp();
  const [copied, setCopied] = useState(false);
  const [desktop] = useState(desktopMcp);
  useEffect(() => { if (!mcp.code && !desktop) mcp.newCode(); }, [mcp.code]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = mcpStatusView(mcp.status.state, mcp.status.error);
  const prompt = mcp.code ? mcpAgentPrompt(mcp.code) : '';
  const copy = () => {
    void navigator.clipboard?.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  return (
    <>
      <Row title="Paste into your coding agent" size="sm" className="px-0" hover={false}
        right={[{ type: 'custom', unboxed: true, node: (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" label="New code" title="Replace the code (drops the connected agent)" onClick={mcp.newCode} />
            <Button variant="ghost" size="sm" label={copied ? 'Copied' : 'Copy prompt'} onClick={copy} disabled={!prompt} />
          </div>
        ) }]} />
      <pre data-testid="mcp-prompt" className="bg-bg-contrast rounded-inner p-2 text-2xs font-mono text-text whitespace-pre-wrap break-all select-all">{prompt}</pre>
      <Row
        size="sm"
        title={<span className="flex items-center gap-2"><McpDot status={mcp.status} />{view.label}</span>}
        rightText={mcp.lastCall ? `Last: ${mcp.lastCall.name}${mcp.lastCall.ok ? '' : ' (failed)'}` : undefined}
        hover={false}
        className="px-0"
      />
      {/* The error is the instruction — a notice wraps it, never truncated like a Row caption. */}
      {mcp.status.error && <OperationNotice title={mcp.status.error} />}
    </>
  );
}
