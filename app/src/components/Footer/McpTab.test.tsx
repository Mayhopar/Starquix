import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { McpTab } from './McpTab';
import { AISettingsButton } from './AISettingsButton';

vi.mock('@/ai/AIContext', () => ({ useAI: () => ({ config: null }) }));
import { McpTestProvider, type McpContextValue } from '@/mcp/__tests__/mcpTestProvider';

const CODE = 'W6J.AB-CDEF01-234567-89ABCD';

function value(over: Partial<McpContextValue> = {}): McpContextValue {
  return { status: { state: 'waiting' }, lastCall: null, code: CODE, newCode: vi.fn(), ...over };
}
function renderTab(over: Partial<McpContextValue> = {}) {
  const v = value(over);
  render(<McpTestProvider value={v}><McpTab /></McpTestProvider>);
  return v;
}

describe('McpTab: one prompt to copy + the light', () => {
  it('the prompt pairs with THIS tab’s code and points the agent at get_project’s designGuide', () => {
    renderTab();
    const prompt = screen.getByTestId('mcp-prompt').textContent!;
    expect(prompt).toContain('sq = npx -y starquix-mcp');
    expect(prompt).toContain(`sq pair --code ${CODE}`);
    expect(prompt).toContain('call get_project');
    expect(prompt).toContain('designGuide');
    expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeEnabled();
    expect(screen.getByText('Waiting for agent')).toBeInTheDocument();
  });
  it('connected: green status with the last call; New code replaces the code', () => {
    const v = renderTab({ status: { state: 'connected' }, lastCall: { id: '1', name: 'add_page', args: {}, ok: true, at: 0 } });
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Last: add_page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New code' }));
    expect(v.newCode).toHaveBeenCalled();
  });
  it('refused: the relay error is shown, not a silent retry', () => {
    renderTab({ status: { state: 'disconnected', error: 'The relay refused the pairing' } });
    expect(screen.getByText('Refused')).toBeInTheDocument();
    expect(screen.getByText(/refused the pairing/)).toBeInTheDocument();
  });
  it('in the desktop app the prompt runs the relay bundled in the app (no npm package)', async () => {
    const { mcpAgentPrompt } = await import('@/mcp/clientSetup');
    const cmd = 'ELECTRON_RUN_AS_NODE=1 "/Applications/Starquix.app/Contents/MacOS/Starquix" "/Applications/Starquix.app/Contents/Resources/mcp/starquix-mcp.mjs"';
    (globalThis as { sqDesktop?: unknown }).sqDesktop = { mcpCommand: cmd };
    try { expect(mcpAgentPrompt(CODE)).toContain(`sq = ${cmd}`); }
    finally { delete (globalThis as { sqDesktop?: unknown }).sqDesktop; }
  });

  it('on a dev server the prompt runs this checkout’s relay build (starquix-mcp is not on npm yet)', async () => {
    vi.stubEnv('VITE_SQ_MCP_BIN', '/repo dir/mcp/dist/cli.js');
    try {
      const { mcpAgentPrompt } = await import('@/mcp/clientSetup');
      expect(mcpAgentPrompt(CODE)).toContain('sq = node "/repo dir/mcp/dist/cli.js"');
    } finally { vi.unstubAllEnvs(); }
  });
});

describe('MCP light (the terminal panel) and the model pill', () => {
  const pill = (variant: 'mcp' | 'model', over: Partial<McpContextValue> | null) => {
    const onClick = vi.fn();
    const button = <AISettingsButton variant={variant} onClick={onClick} />;
    render(over === null ? button : <McpTestProvider value={value(over)}>{button}</McpTestProvider>);
    return onClick;
  };
  it('connected: green "MCP · Connected", click opens the settings', () => {
    const onClick = pill('mcp', { status: { state: 'connected' } });
    const el = screen.getByRole('button', { name: /MCP · Connected/ });
    expect(el.querySelector('.bg-success')).not.toBeNull();
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalled();
  });
  it('waiting: grey "MCP · Waiting for agent"', () => {
    pill('mcp', { status: { state: 'waiting' } });
    expect(screen.getByRole('button', { name: /MCP · Waiting for agent/ }).querySelector('.bg-text-muted')).not.toBeNull();
  });
  it('agent multiplayer (ledger G): while the agent works the light pulses in the AI color and names the file, then fades', async () => {
    vi.useFakeTimers();
    try {
      const { noteAgentActivity, AGENT_ACTIVE_MS } = await import('@/services/agentPresence');
      pill('mcp', { status: { state: 'connected' } });
      act(() => { noteAgentActivity({ projectId: 'p', file: 'src/content/blog/introducing-starquix.mdx' }); });
      const el = screen.getByRole('button', { name: /Agent · introducing-starquix\.mdx/ });
      expect(el.querySelector('.bg-overlay-ai.animate-pulse')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(AGENT_ACTIVE_MS); });
      expect(screen.getByRole('button', { name: /MCP · Connected/ })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
  it('the model pill is always the model — never the MCP light, even while MCP is connected', () => {
    pill('model', { status: { state: 'connected' } });
    expect(screen.getByRole('button', { name: /No model/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MCP ·/ })).toBeNull();
  });
});

describe('McpTab in the desktop app: one prompt, no per-agent rows', () => {
  afterEach(() => { delete (globalThis as { sqDesktop?: unknown }).sqDesktop; });

  it('shows the prompt directly — no agent Connect rows, no code minted', () => {
    (globalThis as { sqDesktop?: unknown }).sqDesktop = { mcpCommand: 'ELECTRON_RUN_AS_NODE=1 "/A/Starquix" "/A/starquix-mcp.mjs"', mcp: {} };
    const v = renderTab();
    expect(screen.getByTestId('mcp-prompt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(v.newCode).not.toHaveBeenCalled();
  });
  it('the prompt tells the agent to register the SAME launcher it runs as sq in its own MCP settings', async () => {
    const { mcpAgentPrompt } = await import('@/mcp/clientSetup');
    (globalThis as { sqDesktop?: unknown }).sqDesktop = { mcpCommand: '"/h/.starquix-mcp/bin/starquix-mcp"' };
    const prompt = mcpAgentPrompt(CODE);
    expect(prompt).toContain('sq = "/h/.starquix-mcp/bin/starquix-mcp"');
    expect(prompt).toMatch(/^4\..*MCP server named "starquix".*runs "\/h\/\.starquix-mcp\/bin\/starquix-mcp" \(no arguments\)/m);
  });
  it('Windows: sq stays the .cmd launcher; the registration is the app runtime + script + env (agents spawn an .exe, never a .cmd)', async () => {
    const { mcpAgentPrompt } = await import('@/mcp/clientSetup');
    const server = { command: 'C:\\Users\\Jo\\AppData\\Local\\Programs\\Starquix\\Starquix.exe', args: ['C:\\Users\\Jo\\AppData\\Local\\Programs\\Starquix\\resources\\mcp\\starquix-mcp.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } };
    (globalThis as { sqDesktop?: unknown }).sqDesktop = { mcpCommand: '"C:\\Users\\Jo\\.starquix-mcp\\bin\\starquix-mcp.cmd"', mcpServer: server };
    const prompt = mcpAgentPrompt(CODE);
    expect(prompt).toContain('sq = "C:\\Users\\Jo\\.starquix-mcp\\bin\\starquix-mcp.cmd"');
    const line = prompt.split('\n').find(l => l.startsWith('4.'))!;
    expect(JSON.parse(line.slice(line.indexOf('{')))).toEqual(server);
    expect(line).not.toContain('.cmd');
  });
  it('outside the desktop app the registration line runs the same relay command', async () => {
    const { mcpAgentPrompt } = await import('@/mcp/clientSetup');
    expect(mcpAgentPrompt(CODE)).toMatch(/^4\..*runs npx -y starquix-mcp \(no arguments\)/m);
  });
});
