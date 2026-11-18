// Instance lifecycle tools: reset / make_component / place / gated push.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { resetInstanceToOriginal, makeComponentFromDrawn, pushInstanceToSource } from '@/store/instanceLifecycle';
import { applyCommand } from '@/store/commands';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { makeCtx, type ExecTool } from './testCtx';

vi.mock('@/store/instanceLifecycle', () => ({
  resetInstanceToOriginal: vi.fn(() => ({ ok: true })),
  makeComponentFromDrawn: vi.fn(async () => ({ ok: true, componentName: 'Section1', instanceId: 'el-new' })),
  pushInstanceToSource: vi.fn(() => ({ ok: true })),
}));
vi.mock('@/hooks/useSourceHtml', () => ({
  resolveSourceHtml: vi.fn(async () => '<div>resolved</div>'),
}));

function libComponent(over: Partial<ScannedComponent> = {}): ScannedComponent {
  return {
    name: 'Hero',
    path: 'built-in/Hero.astro',
    source: 'built-in',
    html: '<section class="hero">Hero</section>',
    category: 'sections',
    props: [],
    slots: [],
    dependencies: [],
    ...over,
  };
}

function seedInstance(ctx: ReturnType<typeof makeCtx>, id = 'el-inst') {
  applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
  applyCommand(ctx.doc, {
    type: 'ADD_THEME_INSTANCE',
    element: {
      id, pageId: 'page-1', parentId: null, index: 0,
      type: 'instance', instanceType: 'theme',
      themeId: 'Hero', componentPath: 'built-in/Hero.astro',
      astroSource: 'built-in/Hero.astro',
      staticMarkup: '<section>old</section>',
      classes: { base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] },
    },
  });
}

/** Local component instances carry astroSource — the only push-eligible shape
 * (ADD_THEME_INSTANCE drops astroSource; theme instances can't push in the UI either). */
function seedLocalInstance(ctx: ReturnType<typeof makeCtx>, id = 'el-inst') {
  applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
  applyCommand(ctx.doc, {
    type: 'ADD_ELEMENT',
    element: {
      id, pageId: 'page-1', parentId: null, index: 0,
      type: 'component', instanceType: 'local',
      componentType: 'Hero',
      astroSource: 'built-in/Hero.astro',
      staticMarkup: '<section>old</section>',
      classes: { base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] },
    },
  });
}

beforeEach(() => {
  vi.mocked(resetInstanceToOriginal).mockClear();
  vi.mocked(makeComponentFromDrawn).mockClear();
  vi.mocked(pushInstanceToSource).mockClear();
});

describe('reset_instance', () => {
  it('calls resetInstanceToOriginal (drop overrides, no source round-trip)', async () => {
    const ctx = makeCtx({ componentLibrary: [libComponent()] });
    seedInstance(ctx);
    const tools = generateCommandTools(ctx);
    const r = await (tools.reset_instance as ExecTool).execute({ instanceId: 'el-inst' });
    expect(resetInstanceToOriginal).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'el-inst',
      currentPageId: 'page-1',
      isBlogSlot: false,
    }));
    expect(r.success).toBe(true);
  });

  it('fails on unknown instance', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.reset_instance as ExecTool).execute({ instanceId: 'nope' });
    expect(resetInstanceToOriginal).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
  });
});

describe('make_component', () => {
  it('calls makeComponentFromDrawn with library names', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1', componentLibrary: [libComponent()] });
    const tools = generateCommandTools(ctx);
    const r = await (tools.make_component as ExecTool).execute({ key: 'drawn-1' });
    expect(makeComponentFromDrawn).toHaveBeenCalledWith(expect.objectContaining({
      key: 'drawn-1',
      currentPageId: 'page-1',
      existingNames: ['Hero'],
    }));
    expect(r.success).toBe(true);
    expect(r.data?.componentName).toBe('Section1');
  });
});

describe('place_component_instance', () => {
  it('places a library component via the picker path (ADD_ELEMENT for local components)', async () => {
    const ctx = makeCtx({ currentPageId: 'page-1', componentLibrary: [libComponent()] });
    const tools = generateCommandTools(ctx);
    const r = await (tools.place_component_instance as ExecTool).execute({ componentPath: 'built-in/Hero.astro' });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ADD_ELEMENT',
      element: expect.objectContaining({
        componentType: 'Hero',
        astroSource: 'built-in/Hero.astro',
        staticMarkup: '<section class="hero">Hero</section>',
        parentId: null,
      }),
    }));
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data?.elementId).toBeTruthy();
  });

  it('refuses to insert squatter-poisoned bare div#root markup', async () => {
    const ctx = makeCtx({
      currentPageId: 'page-1',
      componentLibrary: [libComponent({ html: '<div id="root"></div>' })],
    });
    const tools = generateCommandTools(ctx);
    const r = await (tools.place_component_instance as ExecTool).execute({ componentPath: 'built-in/Hero.astro' });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/div#root/);
  });
});

describe('push_instance_to_source gating', () => {
  it('is always generated (no runtime gate)', () => {
    const tools = generateCommandTools(makeCtx());
    expect(tools.push_instance_to_source).toBeDefined();
  });

  // Owner 2026-11-10: no popup — the push acts at once and one ⌘Z takes it back (pushInstanceToSource's snapshot).
  it('pushes at once: no popup, no confirm param', async () => {
    const ctx = makeCtx();
    seedLocalInstance(ctx);
    const native = vi.spyOn(window, 'confirm');
    const tools = generateCommandTools(ctx);
    const r = await (tools.push_instance_to_source as ExecTool).execute({ instanceId: 'el-inst' });
    expect(pushInstanceToSource).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'el-inst',
      astroSource: 'built-in/Hero.astro',
      takeSnapshot: ctx.takeSnapshot,
    }));
    expect(r.success).toBe(true);
    expect(native).not.toHaveBeenCalled();
  });
});
