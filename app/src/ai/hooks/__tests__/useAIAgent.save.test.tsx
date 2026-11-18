import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAIAgent } from '../useAIAgent';
import { CONFIRM_RULE } from '../../tools/commandRegistry';
import type { ToolExecutionContext } from '../../tools/commandTools';
const h = vi.hoisted(() => ({ session: 'chat-1', abortRef: { current: null as AbortController | null }, save: vi.fn(), update: vi.fn(), error: vi.fn(), generating: vi.fn(), success: vi.fn(), generate: vi.fn(), snapshot: vi.fn(), commitSnapshot: vi.fn(), toolCtx: null as ToolExecutionContext | null }));
vi.mock('@/store', () => ({ useEditorDoc: () => ({}), useDispatch: () => vi.fn(), useYjsValue: () => 'page-1' }));
vi.mock('@/context', () => ({ useClassStore: () => ({ saveAll: h.save }) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: h.snapshot, undo: vi.fn(), redo: vi.fn(), pushStructuralUndo: vi.fn() }) }));
vi.mock('@/context/SelectionContext', () => ({ useSelectionContext: () => ({ selectedKey: null }), useScannedElements: () => ({ scannedElements: [] }), useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }) }));
vi.mock('@/hooks/useLayoutLibrary', () => ({ useLayoutLibrary: () => ({ layouts: [] }) }));
vi.mock('../../AIService', () => ({ generateWithTools: (...args: unknown[]) => h.generate(...args) }));
vi.mock('../../AIContext', () => ({ useAI: () => ({ activeSessionId: h.session, config: { provider: 'anthropic', apiKey: 'test' }, contextElements: [], messages: [], setIsGenerating: h.generating, setStreamedContent: vi.fn(), setError: h.error, addMessage: vi.fn(), updateMessage: h.update, clearContextElements: vi.fn(), markActiveKey: vi.fn(), clearActiveKeys: vi.fn(), recordTouchedKey: vi.fn(), abortRef: h.abortRef }) }));
vi.mock('../../imageGen', () => ({ resolveImageGen: () => null }));
vi.mock('../../tools/commandTools', () => ({ generateCommandTools: (ctx: ToolExecutionContext) => { h.toolCtx = ctx; return {}; } }));
vi.mock('../../dev/mockRunner', () => ({ isMockEnabled: () => false, runMockAgent: vi.fn() }));
// The parts of the system prompt; empty unless a test fills them.
const p = vi.hoisted(() => ({ saved: undefined as string | undefined, style: '', state: '', variables: '', blog: '', page: '' }));
const NO_PROMPT = { ...p };
vi.mock('../../tools/autoContext', () => ({ buildAutoContext: () => '', formatAutoContext: () => p.state, buildPageStructureContext: () => p.page, buildVariablesContext: () => p.variables, buildBlogContext: () => p.blog }));
vi.mock('../../prompts/userPrompts', () => ({ loadCustomPrompts: () => ({ systemPrompt: p.saved }), DEFAULT_SYSTEM_PROMPT: '' }));
vi.mock('../../styles/styleLibrary', () => ({ getActiveStyleSection: () => p.style, loadBundledThemes: async () => {} }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: h.success }) }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(p, NO_PROMPT);
  h.abortRef.current = null;
  h.session = 'chat-1';
  h.save.mockResolvedValue(undefined);
  h.snapshot.mockImplementation((_asset, _command, defer) => defer ? h.commitSnapshot : undefined);
  h.generate.mockImplementation(async (_config, _messages, _tools, callbacks) => {
    callbacks.onToolCall('update_element_by_key', { sourceKey: 'src/pages/index.astro:3:1', classes: 'p-4' });
    callbacks.onToolResult('update_element_by_key', { success: true });
    callbacks.onComplete('Done');
  });
});
it('forwards deferred Push snapshots without arming the AI batch until acceptance commits', async () => {
  h.generate.mockImplementationOnce(async (_config, _messages, _tools, callbacks) => {
    h.toolCtx!.takeSnapshot(undefined, undefined, true); // Rejected acceptance: never commit this reservation.
    expect(h.snapshot).toHaveBeenCalledWith(undefined, undefined, true);
    expect(h.commitSnapshot).not.toHaveBeenCalled();
    const commit = h.toolCtx!.takeSnapshot(undefined, undefined, true);
    expect(h.snapshot).toHaveBeenCalledTimes(2);
    commit?.();
    expect(h.commitSnapshot).toHaveBeenCalledTimes(1);
    h.toolCtx!.takeSnapshot();
    expect(h.snapshot).toHaveBeenCalledTimes(2);
    callbacks.onComplete('Done');
  });
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Push'); });
  expect(h.commitSnapshot).toHaveBeenCalledTimes(1);
});
it('AI completion awaits the save owner before publishing success', async () => {
  let finish!: () => void;
  h.save.mockImplementationOnce(() => new Promise<void>(r => { finish = r; }));
  const { result } = renderHook(() => useAIAgent());
  let run!: Promise<void>;
  await act(async () => { run = result.current.submitAgentPrompt('Change spacing'); await Promise.resolve(); });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.update.mock.calls.some(([, value]) => value.status === 'complete')).toBe(false);
  expect(h.generating).not.toHaveBeenLastCalledWith(false);
  await act(async () => { finish(); await run; });
  expect(h.success).toHaveBeenCalledTimes(1);
  expect(h.update.mock.calls.some(([, value]) => value.status === 'complete')).toBe(true);
});
it('a failed AI completion save publishes an error without a success toast or unhandled rejection', async () => {
  h.save.mockRejectedValueOnce(new Error('source write refused'));
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Change spacing'); });
  expect(h.error).toHaveBeenLastCalledWith('Some changes have not reached the project files yet.');
  expect(h.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ status: 'error' }));
  expect(h.success).not.toHaveBeenCalled();
});

it.each(['callback', 'throw'])('retains the exact partial reply on %s provider failure', async path => {
  h.generate.mockImplementationOnce(async (_config, _messages, _tools, callbacks) => {
    callbacks.onText('Partial model reply.\n  Kept exactly.');
    const error = Object.assign(new Error('<html>token-secret /private/file</html>'), { statusCode: 401 });
    if (path === 'throw') throw error;
    callbacks.onError(error);
  });
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Keep my prompt'); });
  expect(h.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    status: 'error', content: 'Partial model reply.\n  Kept exactly.', failure: 'authorization',
  }));
  expect(JSON.stringify(h.update.mock.calls)).not.toContain('token-secret');
  expect(h.success).not.toHaveBeenCalled();
});
it('retains the model reply separately from a failed durable save', async () => {
  h.save.mockRejectedValueOnce(new Error('token-secret /private/file'));
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Change spacing'); });
  expect(h.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    status: 'error', content: 'Done', failure: 'save',
  }));
  expect(JSON.stringify(h.update.mock.calls)).not.toContain('token-secret');
});
it('an old cancelled run cannot clear the newer run or publish its late failure', async () => {
  let failOld!: () => void;
  let finishNew!: () => void;
  h.generate.mockImplementationOnce((_c, _m, _t, cb) => new Promise<void>(resolve => {
    failOld = () => { cb.onError(new Error('late-old-token-secret')); resolve(); };
  })).mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve; }));
  const { result } = renderHook(() => useAIAgent());
  let oldRun!: Promise<void>;
  let newRun!: Promise<void>;
  await act(async () => { oldRun = result.current.submitAgentPrompt('old'); await Promise.resolve(); });
  act(() => result.current.cancelGeneration());
  await act(async () => { newRun = result.current.submitAgentPrompt('new'); await Promise.resolve(); });
  const newController = h.abortRef.current;
  h.error.mockClear(); h.generating.mockClear();
  await act(async () => { failOld(); await oldRun; });
  expect(h.abortRef.current).toBe(newController);
  expect(h.generating).not.toHaveBeenCalledWith(false);
  expect(h.error).not.toHaveBeenCalled();
  await act(async () => { finishNew(); await newRun; });
});

it('a late provider failure updates its message without setting another chat’s error', async () => {
  let fail!: () => void;
  h.generate.mockImplementationOnce((_c, _m, _t, cb) => new Promise<void>(resolve => {
    fail = () => { cb.onError(Object.assign(new Error('old-token-secret'), { status: 402 })); resolve(); };
  }));
  const { result, rerender } = renderHook(() => useAIAgent());
  let run!: Promise<void>;
  await act(async () => { run = result.current.submitAgentPrompt('original chat'); await Promise.resolve(); });
  h.session = 'chat-2'; rerender(); h.error.mockClear();
  await act(async () => { fail(); await run; });
  expect(h.error).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ status: 'error', failure: 'credits' }));
});
it('failed tool diagnostics stay out of the stored activity feed', async () => {
  h.generate.mockImplementationOnce(async (_c, _m, _t, cb) => {
    cb.onToolCall('update_element_by_key', { sourceKey: 'element-1', classes: 'p-4' });
    cb.onToolResult('update_element_by_key', { error: '<html>token-secret /private/file</html>' });
    cb.onComplete('Could not update that element.');
  });
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Change spacing'); });
  expect(JSON.stringify(h.update.mock.calls)).not.toContain('token-secret');
  expect(h.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    activities: [expect.objectContaining({ status: 'error', detail: 'This action could not finish.' })],
  }));
});
it('a failed finish preserves confirmed tool results and never marks unresolved work successful', async () => {
  h.generate.mockImplementationOnce(async (_c, _m, _t, cb) => {
    cb.onToolCall('update_element_by_key', { sourceKey: 'confirmed' });
    cb.onToolResult('update_element_by_key', { success: true });
    cb.onToolCall('update_element_by_key', { sourceKey: 'refused' });
    cb.onToolResult('update_element_by_key', { success: false });
    cb.onToolCall('update_element_by_key', { sourceKey: 'unresolved' });
    cb.onComplete('Partial.', { finishReason: 'error', stepsUsed: 1, stepCap: 40 });
  });
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Change spacing'); });
  expect(h.success).not.toHaveBeenCalled();
  expect(h.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    status: 'error', content: 'Partial.', failure: 'unknown',
    activities: [
      expect.objectContaining({ key: 'confirmed', status: 'done' }),
      expect.objectContaining({ key: 'refused', status: 'error' }),
      expect.objectContaining({ key: 'unresolved', status: 'error' }),
    ],
  }));
});
it('records where each run of reply text began, so the chat shows text → tools → text in order', async () => {
  h.generate.mockImplementationOnce(async (_config, _messages, _tools, callbacks) => {
    callbacks.onText('On it.');
    callbacks.onToolCall('update_element_by_key', { sourceKey: 'src/pages/index.astro:3:1', classes: 'p-4' });
    callbacks.onToolResult('update_element_by_key', { success: true });
    callbacks.onText('On it.Done.');
    callbacks.onComplete('On it.Done.');
  });
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Add padding'); });
  const anchors = h.update.mock.calls.map(c => c[1].textAnchors).filter(Boolean);
  expect(anchors[anchors.length - 1]).toEqual([{ activityIndex: 0, offset: 0 }, { activityIndex: 1, offset: 6 }]);
});
it('a tool held for the user\'s OK reads "waiting for your OK", not a red failure; the prompt carries the rule', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  h.generate.mockImplementationOnce(async (_c, messages, _t, cb) => {
    expect(messages[0].content).toContain('"confirm": true'); // CONFIRM_RULE, outside the user-editable base prompt
    cb.onToolCall('deploy_project', { provider: 'vercel' });
    cb.onToolResult('deploy_project', { success: false, cancelled: true, needsConfirmation: true, message: 'Deploy? Ask the user.' });
    cb.onComplete('Deploy the site publicly now?');
  });
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Publish it'); });
  expect(h.update).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
    activities: [expect.objectContaining({ status: 'done', detail: 'waiting for your OK' })],
  }));
  expect(errors).not.toHaveBeenCalled();
});
it('measures the stable start of the system prompt — saved prompt, confirm rule, style — for the provider prompt cache; the text and its order stay as they were', async () => {
  Object.assign(p, { saved: 'SAVED PROMPT', style: '## Style Prompt', state: '## Current Editor State', variables: '## Design Variables', blog: '## Blog & Collections', page: '## Page Structure' });
  let system!: { content: string; stableChars?: number };
  h.generate.mockImplementationOnce(async (_c, messages, _t, cb) => { system = messages[0]; cb.onComplete('Done'); });
  const { result } = renderHook(() => useAIAgent());
  await act(async () => { await result.current.submitAgentPrompt('Change spacing'); });
  const stable = `SAVED PROMPT\n\n${CONFIRM_RULE}\n\n## Style Prompt`;
  expect(system.content).toBe(`${stable}\n\n## Current Editor State\n\n## Design Variables\n\n## Blog & Collections\n\n## Page Structure`);
  expect(system.content.slice(0, system.stableChars)).toBe(stable);
});
