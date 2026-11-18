import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';

const addMessage = vi.fn();
const awaitJournaledFiles = vi.fn(async () => {});
const useLayoutLibrary = vi.fn(() => ({ layouts: [] }));
const doc = new Y.Doc();

vi.mock('@/store', () => ({
  useEditorDoc: () => doc,
  useDispatch: () => vi.fn(async () => true),
  useYjsValue: () => 'base',
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn(), claimSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false, pushStructuralUndo: vi.fn() }),
}));
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ awaitJournaledFiles: (...a: unknown[]) => awaitJournaledFiles(...a as []) }));
// Fresh objects per render ON PURPOSE: the hook must not key its session
// effect on these identities (it once did → connect/close loop → OOM).
vi.mock('@/context/SelectionContext', () => ({
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }),
  useSelectionRefs: () => ({ selectedKeyRef: { current: null } }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({ useLayoutLibrary: () => useLayoutLibrary() }));
const aiConfig = vi.hoisted(() => ({ current: null as null | { provider: string; apiKey: string } }));
vi.mock('@/ai/AIContext', () => ({ useAI: () => ({ config: aiConfig.current, addMessage }) }));
const driver = vi.hoisted(() => ({ status: 'running' }));
vi.mock('@/services/desktopDriver', () => ({ desktopDriver: { status: async () => ({ status: driver.status }) } }));

import { useMcpSession } from '../useMcpSession';
import { McpProvider, useMcp } from '../McpContext';
import { getStoredCode, setStoredCode } from '../codeStore';
import { FakeWS } from './fakeSocket';

const makeSocket = (url: string) => new FakeWS(url);
const tick = () => act(() => new Promise(r => setTimeout(r, 0)));
const CODE = 'XXX.' + 'b'.repeat(24);
const host = (code: string) => renderHook(() => useMcpSession({ code, projectId: 'browser_p', projectName: 'Site', onStatus: vi.fn(), onCall: vi.fn(), makeSocket }));

beforeEach(() => { localStorage.clear(); FakeWS.instances = []; addMessage.mockClear(); awaitJournaledFiles.mockClear(); useLayoutLibrary.mockClear(); });

describe('useMcpSession (session host)', () => {
  it('dials the relay from the code and says hello with the project', async () => {
    host(CODE); await tick();
    expect(FakeWS.instances[0].url).toBe('ws://127.0.0.1:43989');
    expect(FakeWS.instances[0].sent[0]).toMatchObject({ type: 'hello', projectId: 'browser_p', projectName: 'Site' });
  });

  it('serves the real catalogue after hello-ok', async () => {
    host(CODE); await tick();
    const ws = FakeWS.instances[0];
    act(() => ws.receive({ type: 'hello-ok', v: 1 }));
    act(() => ws.receive({ id: '1', type: 'tools/list' }));
    await tick(); await tick();
    const reply = ws.sent.at(-1) as { id: string; tools: { name: string }[] };
    expect(reply.id).toBe('1');
    expect(reply.tools.map(t => t.name)).toEqual(expect.arrayContaining(['add_page', 'get_project', 'read_file']));
    expect(reply.tools.length).toBeGreaterThan(50);
  });

  it('mirrors a finished call into the chat feed; a read-only call does not flush', async () => {
    const { result } = renderHook(() => { const onCall = vi.fn(); useMcpSession({ code: CODE, projectId: 'browser_p', projectName: 'Site', onStatus: vi.fn(), onCall, makeSocket }); return onCall; });
    await tick();
    const ws = FakeWS.instances[0];
    act(() => ws.receive({ type: 'hello-ok', v: 1 }));
    act(() => ws.receive({ id: 'c1', type: 'tools/call', name: 'get_project', args: {} }));
    // get_project awaits the lazy themes.json load (designGuide) — wait for the reply, not a tick count.
    await act(() => vi.waitFor(() => expect(ws.sent.at(-1)).toMatchObject({ id: 'c1', result: { projectId: 'browser_p', projectName: 'Site' } }), { timeout: 5000 }));
    expect(result.current).toHaveBeenCalledWith(expect.objectContaining({ name: 'get_project', ok: true }));
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ role: 'assistant', activities: [expect.objectContaining({ toolName: 'get_project', status: 'done' })] }));
    expect(awaitJournaledFiles).not.toHaveBeenCalled();
  });

  it('readiness follows the desktop driver: a call made while the project starts waits, then runs (no refusal)', async () => {
    driver.status = 'starting';
    try {
      host(CODE); await tick();
      const ws = FakeWS.instances[0];
      act(() => ws.receive({ type: 'hello-ok', v: 1 }));
      act(() => ws.receive({ id: 'd1', type: 'tools/call', name: 'get_project', args: {} }));
      await act(() => new Promise(r => setTimeout(r, 300)));
      expect(ws.sent.some(m => (m as { id?: string }).id === 'd1')).toBe(false); // waiting, not refused
      driver.status = 'running';
      await act(() => vi.waitFor(() => expect(ws.sent.at(-1)).toMatchObject({ id: 'd1', result: { projectId: 'browser_p' } }), { timeout: 5000 }));
    } finally { driver.status = 'running'; }
  });

  it('flushes through awaitJournaledFiles (materialize + journal pull, no folder re-read) after a mutating call', async () => {
    host(CODE); await tick();
    const ws = FakeWS.instances[0];
    act(() => ws.receive({ type: 'hello-ok', v: 1 }));
    act(() => ws.receive({ id: 'm1', type: 'tools/call', name: 'create_variable_collection', args: { name: 'Brand' } }));
    for (let i = 0; i < 6; i++) await tick();
    expect(ws.sent.at(-1)).toMatchObject({ id: 'm1', result: { success: true } });
    expect(awaitJournaledFiles).toHaveBeenCalledWith('browser_p', { agent: true }); // an agent call never commits the user's typed draft
  });
});

describe('McpProvider (always on: no mode — the chat is API-only, MCP serves the terminal and outside agents)', () => {
  function Probe() { const m = useMcp(); return <div data-testid="state">{m.status.state}|{m.code ?? '-'}</div>; }
  const renderProvider = () => render(<McpProvider projectId="browser_p" projectName="Site" makeSocket={makeSocket}><Probe /></McpProvider>);

  it('no code yet: stays off and mounts NO session hooks (no layout-library fetch)', () => {
    const { getByTestId } = renderProvider();
    expect(getByTestId('state').textContent).toBe('off|-');
    expect(FakeWS.instances).toHaveLength(0);
    expect(useLayoutLibrary).not.toHaveBeenCalled();
  });

  it('nothing is minted or dialed until the MCP settings are shown; then it dials the relay port', async () => {
    let ctx!: ReturnType<typeof useMcp>;
    function Grab() { ctx = useMcp(); return null; }
    render(<McpProvider projectId="browser_p" projectName="Site" makeSocket={makeSocket}><Grab /></McpProvider>);
    await tick();
    expect(getStoredCode('browser_p')).toBeNull();
    expect(FakeWS.instances).toHaveLength(0);
    act(() => ctx.newCode()); // what McpTab does on first show
    await tick();
    expect(getStoredCode('browser_p')).toMatch(/^10WD\./); // DEFAULT_RELAY_PORT 47821 in base36
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toBe('ws://127.0.0.1:47821');
    act(() => FakeWS.instances[0].receive({ type: 'hello-ok', v: 1 }));
    expect(ctx.status.state).toBe('connected');
  });

  it('a ?mcp= code from `pair` dials at once', async () => {
    localStorage.setItem('sq:mcp:pending', CODE);
    renderProvider();
    await tick();
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('a stored code dials on load, also with a working chat key (no API/MCP switch any more)', async () => {
    aiConfig.current = { provider: 'openrouter', apiKey: 'sk-or-x' };
    try {
      setStoredCode('browser_p', CODE);
      const { getByTestId } = renderProvider();
      await tick();
      expect(FakeWS.instances).toHaveLength(1);
      act(() => FakeWS.instances[0].receive({ type: 'hello-ok', v: 1 }));
      expect(getByTestId('state').textContent).toBe(`connected|${CODE}`);
    } finally { aiConfig.current = null; }
  });
});

describe('McpProvider in the desktop app: one app-wide code from main, nothing pasted', () => {
  const APP_CODE = '10WD.' + 'c'.repeat(24);
  function stub() {
    let push: (c: string) => void = () => {};
    const mcp = { code: vi.fn(async () => APP_CODE), rotate: vi.fn(async () => '10WD.' + 'd'.repeat(24)), onCode: vi.fn((cb: (c: string) => void) => { push = cb; return () => {}; }) };
    (globalThis as { sqDesktop?: unknown }).sqDesktop = { mcp };
    return { mcp, push: (c: string) => push(c) };
  }
  afterEach(() => { delete (globalThis as { sqDesktop?: unknown }).sqDesktop; });

  it('dials the code main hands over (no localStorage code), follows relay rewrites, New code rotates in main', async () => {
    const { mcp, push } = stub();
    let ctx!: ReturnType<typeof useMcp>;
    function Grab() { ctx = useMcp(); return null; }
    render(<McpProvider projectId="browser_p" projectName="Site" makeSocket={makeSocket}><Grab /></McpProvider>);
    await tick();
    expect(ctx.code).toBe(APP_CODE);
    expect(getStoredCode('browser_p')).toBeNull();
    expect(FakeWS.instances).toHaveLength(1);
    act(() => push('10WE.' + 'c'.repeat(24))); // relay took another port
    expect(ctx.code).toBe('10WE.' + 'c'.repeat(24));
    act(() => ctx.newCode());
    await tick();
    expect(mcp.rotate).toHaveBeenCalledTimes(1);
    expect(ctx.code).toBe('10WD.' + 'd'.repeat(24));
  });

  it('regression: showing the MCP tab before main answers never rotates the code', async () => {
    const { mcp } = stub();
    mcp.code.mockImplementation(() => new Promise(() => {})); // main not answered yet
    const { McpTab } = await import('@/components/Footer/McpTab');
    render(<McpProvider projectId="browser_p" projectName="Site" makeSocket={makeSocket}><McpTab /></McpProvider>);
    await tick();
    expect(mcp.rotate).not.toHaveBeenCalled();
  });
});
