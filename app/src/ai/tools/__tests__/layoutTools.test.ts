// Layout tools: apply (default-prop seeding, picker parity), detach,
// set_layout_props (merge, PageLayoutBlock parity), read_layouts.
import { describe, it, expect } from 'vitest';
import { generateCommandTools } from '../commandTools';
import { applyCommand } from '@/store/commands';
import type { ScannedLayout } from '@/hooks/useLayoutLibrary';
import { makeCtx, type ExecTool } from './testCtx';

const mainLayout: ScannedLayout = {
  name: 'Main',
  path: 'layouts/Main.astro',
  absolutePath: '/x/layouts/Main.astro',
  props: [{ name: 'theme', type: 'string', required: false, defaultValue: 'light' }],
  slots: ['default'],
  frontmatter: '',
  body: '<html><slot /></html>',
};

describe('apply_layout', () => {
  it('dispatches SET_PAGE_LAYOUT with default-seeded props (picker parity)', async () => {
    const ctx = makeCtx({ layoutLibrary: [mainLayout] });
    const tools = generateCommandTools(ctx);
    const r = await (tools.apply_layout as ExecTool).execute({ pageId: 'page-1', layoutName: 'Main' });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'Main', layoutProps: { theme: 'light' },
    }));
    expect(ctx.takeSnapshot).toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('fails on unknown layout, listing available names', async () => {
    const ctx = makeCtx({ layoutLibrary: [mainLayout] });
    const tools = generateCommandTools(ctx);
    const r = await (tools.apply_layout as ExecTool).execute({ pageId: 'page-1', layoutName: 'Nope' });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/Main/);
  });
});

describe('detach_layout', () => {
  it('dispatches SET_PAGE_LAYOUT with layoutName null', async () => {
    const ctx = makeCtx();
    const tools = generateCommandTools(ctx);
    const r = await (tools.detach_layout as ExecTool).execute({ pageId: 'page-1' });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: null,
    }));
    expect(r.success).toBe(true);
  });
});

describe('set_layout_props', () => {
  it('merges into the existing props for the current layout (PageLayoutBlock parity)', async () => {
    const ctx = makeCtx({ layoutLibrary: [mainLayout] });
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
    applyCommand(ctx.doc, { type: 'SET_PAGE_LAYOUT', pageId: 'page-1', layoutName: 'Main', layoutProps: { theme: 'light', width: 'wide' } });
    const tools = generateCommandTools(ctx);
    const r = await (tools.set_layout_props as ExecTool).execute({ pageId: 'page-1', props: { theme: 'dark' } });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_PAGE_LAYOUT',
      pageId: 'page-1',
      layoutName: 'Main',
      layoutProps: { theme: 'dark', width: 'wide' },
    }));
    expect(r.success).toBe(true);
  });

  it('fails when the page has no layout', async () => {
    const ctx = makeCtx();
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] } });
    const tools = generateCommandTools(ctx);
    const r = await (tools.set_layout_props as ExecTool).execute({ pageId: 'page-1', props: { theme: 'dark' } });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
  });
});

describe('read_layouts', () => {
  it('lists available layouts with props', async () => {
    const ctx = makeCtx({ layoutLibrary: [mainLayout] });
    const tools = generateCommandTools(ctx);
    const r = await (tools.read_layouts as { execute: (p: unknown) => Promise<{ layouts: Array<{ name: string }> }> }).execute({});
    expect(r.layouts).toHaveLength(1);
    expect(r.layouts[0].name).toBe('Main');
  });
});
