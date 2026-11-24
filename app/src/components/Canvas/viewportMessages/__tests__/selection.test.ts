import { describe, it, expect, vi } from 'vitest';
import { handleElementClick, handleElementClicked, handleSlotPlaceholderClick } from '../selection';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { layerMenu } from '@/components/Editor/layerMenuStore';

const rect = { top: 1, left: 2, width: 3, height: 4 };
const basePayload = {
  key: 'src/pages/index.astro:5:1',
  tagName: 'section',
  classes: 'p-4',
  rect,
};

describe('ELEMENT_CLICKED (legacy)', () => {
  it('selects via SelectionContext (no command dispatch) and updates the rect', () => {
    const ctx = makeFakeCtx();
    const event = new MessageEvent('message', {
      data: { type: 'ELEMENT_CLICKED', elementId: 'el-1', rect },
    });
    handleElementClicked(ctx, undefined, event);
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith('el-1', { rect });
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(rect);
  });
});

describe('ELEMENT_CLICK', () => {
  it('selects the element: SelectionContext single-write + ClassStore + rect (no command dispatch)', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe } });
    handleElementClick(ctx, basePayload);
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.objectContaining({
      tagName: 'section',
    }));
    expect(ctx.refs.registerElement.current).toHaveBeenCalledWith(basePayload.key, 'p-4', undefined);
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(rect);
    // grid geometry requested
    expect(ctx.actions.setGridGeometry).toHaveBeenCalledWith(null);
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'REQUEST_GRID_GEOMETRY', payload: { key: basePayload.key } }, '*',
    );
  });

  it('alt+click adds to AI context and skips selection', () => {
    const ctx = makeFakeCtx({ refs: { aiContextMode: { current: true } } });
    const spy = vi.fn();
    window.addEventListener('sq:add-ai-context', spy, { once: true });
    handleElementClick(ctx, { ...basePayload, altKey: true });
    expect(spy).toHaveBeenCalled();
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });

  it('double-click on selected leaf text element enters edit mode', () => {
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'k1' } } });
    handleElementClick(ctx, {
      ...basePayload, key: 'k1', tagName: 'p', isDoubleClick: true, hasChildren: false,
    });
    expect(ctx.actions.sendEnterEditMode).toHaveBeenCalledWith('k1');
    expect(ctx.actions.dispatch).not.toHaveBeenCalled();
  });

  it.each(['div', 'section', 'header', 'footer', 'nav', 'article', 'summary'])(
    'double-click edits a selected childless <%s> as Enter does (audit #41)', (tagName) => {
      const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'k1' } } });
      handleElementClick(ctx, { ...basePayload, key: 'k1', tagName, isDoubleClick: true, hasChildren: false });
      expect(ctx.actions.sendEnterEditMode).toHaveBeenCalledWith('k1');
    });

  it('double-click with children enters context (drill down)', () => {
    const ctx = makeFakeCtx();
    handleElementClick(ctx, { ...basePayload, isDoubleClick: true, hasChildren: true });
    expect(ctx.refs.enterContext.current).toHaveBeenCalledWith(basePayload.key);
  });

  it('click outside context resets all drill state', () => {
    const ctx = makeFakeCtx({ refs: { contextKey: { current: 'ctx-1' } } });
    handleElementClick(ctx, { ...basePayload, isOutsideContext: true });
    expect(ctx.refs.resetContext.current).toHaveBeenCalled();
  });

  it('cmd+click (isDirectSelect) skips context logic', () => {
    const ctx = makeFakeCtx({ refs: { contextKey: { current: 'ctx-1' } } });
    handleElementClick(ctx, { ...basePayload, isOutsideContext: true, isDirectSelect: true });
    expect(ctx.refs.resetContext.current).not.toHaveBeenCalled();
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.anything());
  });

  it('cmd/ctrl+click (isDirectSelect) adds to AI context AND still selects', () => {
    const ctx = makeFakeCtx({ refs: { aiContextMode: { current: true } } });
    const spy = vi.fn();
    window.addEventListener('sq:add-ai-context', spy, { once: true });
    handleElementClick(ctx, { ...basePayload, isDirectSelect: true });
    expect(spy).toHaveBeenCalled();
    expect((spy.mock.calls[0][0] as CustomEvent).detail).toEqual({
      key: basePayload.key, tagName: 'section', classes: 'p-4',
    });
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.anything());
  });

  it('cmd/ctrl+click does NOT add to AI context when the AI tab is closed', () => {
    const ctx = makeFakeCtx({ refs: { aiContextMode: { current: false } } });
    const spy = vi.fn();
    window.addEventListener('sq:add-ai-context', spy);
    handleElementClick(ctx, { ...basePayload, isDirectSelect: true });
    window.removeEventListener('sq:add-ai-context', spy);
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.anything());
  });

  it('alt+click with the AI tab closed selects normally instead of capturing context', () => {
    const ctx = makeFakeCtx({ refs: { aiContextMode: { current: false } } });
    const spy = vi.fn();
    window.addEventListener('sq:add-ai-context', spy);
    handleElementClick(ctx, { ...basePayload, altKey: true });
    window.removeEventListener('sq:add-ai-context', spy);
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.anything());
  });

  it('plain click never adds to AI context, even in AI context mode', () => {
    const ctx = makeFakeCtx({ refs: { aiContextMode: { current: true } } });
    const spy = vi.fn();
    window.addEventListener('sq:add-ai-context', spy);
    handleElementClick(ctx, basePayload);
    window.removeEventListener('sq:add-ai-context', spy);
    expect(spy).not.toHaveBeenCalled();
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.anything());
  });

  it('detects position from classes for move behavior', () => {
    const ctx = makeFakeCtx();
    handleElementClick(ctx, { ...basePayload, classes: 'absolute top-0', parentDisplay: 'flex' });
    expect(ctx.actions.setSelectedPosition).toHaveBeenCalledWith('absolute');
  });
});

// db-bound edit blocking is guarded inside the real sendEnterEditMode funnel —
// covered in ViewportFrame.test.tsx (task-114), not at the handler level.

describe('ELEMENT_CLICK with Shift (ledger §1, A3, A6, A10, A13)', () => {
  it('toggles and skips every plain-click step (no select, context, drill or text edit)', () => {
    const toggle = vi.fn(() => 'join');
    const ctx = makeFakeCtx({ refs: { toggleInSelection: { current: toggle }, contextKey: { current: 'ctx-1' }, selectedKey: { current: basePayload.key } } });
    handleElementClick(ctx, { ...basePayload, shiftKey: true, isOutsideContext: true, isDoubleClick: true, hasChildren: false, tagName: 'p' });
    expect(toggle).toHaveBeenCalledWith(basePayload.key, expect.objectContaining({ isLocked: expect.any(Function) }));
    expect(ctx.refs.selectInContext.current).not.toHaveBeenCalled();
    expect(ctx.refs.resetContext.current).not.toHaveBeenCalled();
    expect(ctx.refs.enterContext.current).not.toHaveBeenCalled();
    expect(ctx.actions.sendEnterEditMode).not.toHaveBeenCalled();
  });

  it('a joining member is registered with the ClassStore like a clicked primary (A13)', () => {
    const ctx = makeFakeCtx({ refs: { toggleInSelection: { current: vi.fn(() => 'join') } } });
    handleElementClick(ctx, { ...basePayload, shiftKey: true });
    expect(ctx.refs.registerElement.current).toHaveBeenCalledWith(basePayload.key, 'p-4', undefined);
  });

  it("'select' (nothing selected / primary can't anchor) falls through to a plain select", () => {
    const ctx = makeFakeCtx({ refs: { toggleInSelection: { current: vi.fn(() => 'select') } } });
    handleElementClick(ctx, { ...basePayload, shiftKey: true });
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.anything());
  });

  it('leaves text editing first', () => {
    const ctx = makeFakeCtx({ refs: { isEditingText: { current: true }, toggleInSelection: { current: vi.fn(() => 'join') } } });
    handleElementClick(ctx, { ...basePayload, shiftKey: true });
    expect(ctx.actions.exitEditMode).toHaveBeenCalled();
  });

  it('Alt+click with the AI tab open stays AI-context only', () => {
    const toggle = vi.fn(() => 'join');
    const ctx = makeFakeCtx({ refs: { aiContextMode: { current: true }, toggleInSelection: { current: toggle } } });
    handleElementClick(ctx, { ...basePayload, shiftKey: true, altKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe('SLOT_PLACEHOLDER_CLICK', () => {
  it('relays as a sq:slot-placeholder-click CustomEvent', () => {
    const ctx = makeFakeCtx();
    const spy = vi.fn();
    window.addEventListener('sq:slot-placeholder-click', spy, { once: true });
    handleSlotPlaceholderClick(ctx, { key: 'k1', slotType: 'blog' });
    expect(spy).toHaveBeenCalled();
    expect((spy.mock.calls[0][0] as CustomEvent).detail).toEqual({ key: 'k1', slotType: 'blog' });
  });
});

it('ELEMENT_CLICK carries the actual imported card paths separately from legacy post identity', () => {
  const ctx = makeFakeCtx();
  handleElementClick(ctx, { ...basePayload, postLinkPaths: ['/works/second'] });
  expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.objectContaining({ postLinkPaths: ['/works/second'], postSlug: undefined }));
});

describe('ELEMENT_CLICK after a canvas right-click (issue #5)', () => {
  it('a plain select opens the armed layer menu at the cursor', () => {
    layerMenu.open(null);
    layerMenu.arm({ x: 7, y: 8 });
    const ctx = makeFakeCtx();
    handleElementClick(ctx, basePayload);
    expect(ctx.refs.selectInContext.current).toHaveBeenCalledWith(basePayload.key, expect.anything());
    expect(layerMenu.get()).toEqual({ x: 7, y: 8 });
    layerMenu.open(null);
  });

  it('a click that ends early (text edit entry) consumes the armed point without opening', () => {
    layerMenu.open(null);
    layerMenu.arm({ x: 7, y: 8 });
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'k1' } } });
    handleElementClick(ctx, { ...basePayload, key: 'k1', tagName: 'p', isDoubleClick: true, hasChildren: false });
    expect(layerMenu.get()).toBeNull();
    expect(layerMenu.takeArmed()).toBeNull();
  });

  it('an unarmed click opens nothing', () => {
    layerMenu.open(null);
    handleElementClick(makeFakeCtx(), basePayload);
    expect(layerMenu.get()).toBeNull();
  });
});
