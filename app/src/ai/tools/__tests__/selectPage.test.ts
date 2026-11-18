// select_page + live-scan plumbing (task-119). Uses the shared testCtx factory.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/localElementSource', async (orig) => ({ ...(await orig<object>()), rewriteLocalFile: vi.fn(async () => ({ created: true, changed: true })) }));

import { makeCtx } from './testCtx';
import { generateCommandTools } from '../commandTools';
import { applyCommand } from '@/store/commands';
import type { ScannedElement } from '@/context/SelectionContext';
import { markFilesTruth } from '@/utils/localMode';

describe('live scan access', () => {
  it('read_source_elements reads through getScannedElements at call time', async () => {
    let scan: ScannedElement[] = [];
    const ctx = makeCtx({ getScannedElements: () => scan });
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<unknown> }>;
    scan = [{ key: 'k1', tagName: 'div', classes: '', textContent: '', parentKey: null } as ScannedElement];
    const result = await tools.read_source_elements.execute({});
    expect(JSON.stringify(result)).toContain('k1');
  });
});

describe('live currentPageId access', () => {
  it('add_drawn_element targets the CURRENT doc page, not a stale ctx value', async () => {
    const ctx = makeCtx({ getScannedElements: () => [] });
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'p2', name: 'New', rootElementIds: [], children: [] } } as never);
    applyCommand(ctx.doc, { type: 'SET_CURRENT_PAGE', pageId: 'p2' } as never);
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ success: boolean }> }>;
    const r = await tools.add_drawn_element.execute({ tag: 'div', parentKey: null });
    expect(r.success).toBe(true);
    const call = (ctx.dispatch as ReturnType<typeof import('vitest').vi.fn>).mock.calls
      .map(c => c[0] as { type: string; element?: { pageId?: string } })
      .find(c => c.type === 'ADD_DRAWN_ELEMENT');
    expect(call?.element?.pageId).toBe('p2');
  });
});

describe('select_page', () => {
  it('switches meta.currentPageId and resolves when the scan changes', async () => {
    let scan: ScannedElement[] = [];
    const ctx = makeCtx({ getScannedElements: () => scan });
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'p2', name: 'Target', rootElementIds: [], children: [] } } as never);
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ success: boolean; message: string }> }>;
    const pending = tools.select_page.execute({ pageId: 'p2' });
    // simulate the iframe scanning the new page (identity change)
    scan = [{ key: 'k-new', tagName: 'section', classes: '', textContent: '', parentKey: null } as ScannedElement];
    const r = await pending;
    expect(r.success).toBe(true);
    expect(ctx.doc.getMap('meta').get('currentPageId')).toBe('p2');
  });

  // task-270: a page file made with write_file was not a page — select_page refused it.
  it('opens a page that write_file just created', async () => {
    let scan: ScannedElement[] = [];
    const ctx = makeCtx({ getScannedElements: () => scan });
    ctx.doc.getMap('meta').set('projectId', 'browser_select_page');
    markFilesTruth('browser_select_page');
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ success: boolean; message: string }> }>;
    expect((await tools.write_file.execute({ path: 'src/pages/about.astro', content: '<html></html>\n' })).success).toBe(true);
    const pending = tools.select_page.execute({ pageId: 'about' });
    scan = [{ key: 'k-about', tagName: 'main', classes: '', textContent: '', parentKey: null } as ScannedElement];
    expect((await pending).success).toBe(true);
    expect(ctx.doc.getMap('meta').get('currentPageId')).toBe('about');
  });

  it('rejects an unknown pageId without dispatching', async () => {
    const ctx = makeCtx({ getScannedElements: () => [] });
    const before = ctx.doc.getMap('meta').get('currentPageId');
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ success: boolean; message: string }> }>;
    const r = await tools.select_page.execute({ pageId: 'nope' });
    expect(r.success).toBe(false);
    expect(ctx.doc.getMap('meta').get('currentPageId')).toBe(before);
  });

  it('scan timeout still succeeds but says scan pending', async () => {
    const stableScan: ScannedElement[] = []; // stable identity, like the real ref between scans
    const ctx = makeCtx({ getScannedElements: () => stableScan });
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'p2', name: 'Target', rootElementIds: [], children: [] } } as never);
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ success: boolean; message: string }> }>;
    const r = await tools.select_page.execute({ pageId: 'p2', __scanTimeoutMs: 50 } as object);
    expect(r.success).toBe(true);
    expect(r.message).toMatch(/scan pending/i);
  }, 10_000);
});

describe('add_page auto-switch', () => {
  it('add_page auto-switches the editor to the new page', async () => {
    const ctx = makeCtx({ getScannedElements: () => [] });
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ data?: Record<string, unknown> }> }>;
    const r = await tools.add_page.execute({ page: { id: 'page-x', name: 'Showcase', rootElementIds: [], children: [] } });
    expect(ctx.doc.getMap('meta').get('currentPageId')).toBe('page-x');
    expect(r.data?.switchedToPage).toBe(true);
  }, 10_000);
});

describe('pageId-aware read_element_html error', () => {
  it('read_element_html with a pageId steers the model to select_page', async () => {
    const ctx = makeCtx({ getScannedElements: () => [
      { key: 'k1', tagName: 'div', classes: '', textContent: '', parentKey: null } as ScannedElement,
    ] });
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'page-777', name: 'Other', rootElementIds: [], children: [] } } as never);
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ error?: string }> }>;
    const r = await tools.read_element_html.execute({ sourceKey: 'page-777' });
    expect(r.error).toMatch(/select_page/);
    expect(r.error).toMatch(/read_page_content/);
  });
});

describe('select_page closes an open master view', () => {
  it('re-selecting the CURRENT page still leaves the component view (owner report 2026-10-06)', async () => {
    const { setLocalComponentViewFile } = await import('@/services/localComponentView');
    const ctx = makeCtx({ getScannedElements: () => [] });
    applyCommand(ctx.doc, { type: 'ADD_PAGE', page: { id: 'blog', name: 'Blog', rootElementIds: [], children: [] } } as never);
    applyCommand(ctx.doc, { type: 'SET_CURRENT_PAGE', pageId: 'blog' } as never);
    setLocalComponentViewFile('src/components/BlogSlot.astro');
    const toPage = vi.fn();
    window.addEventListener('sq:go-to-page', toPage);
    const tools = generateCommandTools(ctx) as Record<string, { execute: (p: object) => Promise<{ success: boolean }> }>;
    await tools.select_page.execute({ pageId: 'blog', __scanTimeoutMs: 1 });
    window.removeEventListener('sq:go-to-page', toPage);
    setLocalComponentViewFile(null);
    // The File-tab path: the sidebar leaves the Assets tab AND the view.
    expect(toPage).toHaveBeenCalledTimes(1);
  });
});
