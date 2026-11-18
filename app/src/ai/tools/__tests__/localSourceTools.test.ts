// Files-truth structure / link / layout / instance / read / export tools
// (audit 2026-10-05): each one used to dispatch a doc command the site never
// renders, or refuse in the desktop app. They must write the REAL file.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/components/Editor/localBlogBind', () => ({ commitWholeLocalFile: vi.fn(), bindLocalBlogSlot: vi.fn(), CARD_FILE: 'src/components/BlogCard.astro' }));
vi.mock('@/components/Editor/localLayoutApply', async (orig) => ({ ...(await orig<object>()), applyLocalPageLayout: vi.fn() }));
vi.mock('@/components/Editor/localComponentInsert', () => ({ insertLocalComponent: vi.fn() }));
vi.mock('@/components/Editor/localStructuralOps', async (orig) => ({ ...(await orig<object>()), deleteLocalElement: vi.fn() }));
vi.mock('@/utils/localElementSource', async (orig) => ({ ...(await orig<object>()), readLocalFile: vi.fn(), readLocalElementSource: vi.fn(), rewriteLocalFile: vi.fn() }));
vi.mock('@/utils/localPageSync', async (orig) => ({ ...(await orig<object>()), isLocalPageInSync: () => true }));
vi.mock('@/store/commandGesture', async (orig) => ({ ...(await orig<object>()), acceptEditorCommands: vi.fn() }));
vi.mock('@/store/localMasterOverrides', async (orig) => ({ ...(await orig<object>()), localOverridesForPlacement: vi.fn(), resetLocalOverrides: vi.fn(async () => []) }));
vi.mock('@/store/localPushUndo', () => ({ pushLocalOverridesUndoable: vi.fn() }));
vi.mock('@/components/Canvas/reloadPreview', async (orig) => ({ ...(await orig<object>()), requestPreviewReload: vi.fn() }));
vi.mock('@/services/durableEdits/sourceMaterialization', async (orig) => ({ ...(await orig<object>()), awaitProjectFiles: vi.fn() }));
vi.mock('@/export/filesTruthZip', () => ({ downloadFilesTruthZip: vi.fn(), projectFilesAsArtifacts: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn() }) }));

import { commitWholeLocalFile } from '@/components/Editor/localBlogBind';
import { applyLocalPageLayout } from '@/components/Editor/localLayoutApply';
import { insertLocalComponent } from '@/components/Editor/localComponentInsert';
import { deleteLocalElement } from '@/components/Editor/localStructuralOps';
import { readLocalFile, readLocalElementSource, rewriteLocalFile } from '@/utils/localElementSource';
import { acceptEditorCommands } from '@/store/commandGesture';
import { resetLocalOverrides, localOverridesForPlacement } from '@/store/localMasterOverrides';
import { pushLocalOverridesUndoable } from '@/store/localPushUndo';
import { downloadFilesTruthZip } from '@/export/filesTruthZip';
import { markFilesTruth } from '@/utils/localMode';
import { generateCommandTools } from '../commandTools';
import { unwrapLinkSource } from '@/utils/linkSource';
import { detachLayoutSource } from '@/components/Editor/localLayoutApply';
import { makeCtx, type ExecTool } from './testCtx';

const ID = 'browser_src_site';
const PAGE = 'src/pages/index.astro';
const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
type Tools = Record<string, ExecTool>;
type El = { key: string; tagName: string; classes: string; parentKey: string | null; sourceLocation: { file: string; line: number; column: number } };
const el = (key: string, line: number, tagName = 'section', parentKey: string | null = null, file = PAGE): El =>
  ({ key, tagName, classes: '', parentKey, sourceLocation: { file, line, column: 3 } });

const PAGE_SRC = `---
import Main from '../layouts/Main.astro';
---
<Main title="Home">
  <section>A</section>
  <section>B</section>
  <a href="/x" class="block">
    <span>link</span>
  </a>
</Main>
`;

function ctx(scanned: El[] = []) {
  const c = makeCtx({ currentPageId: 'index', getCurrentPageFile: () => PAGE, getScannedElements: () => scanned as never });
  c.doc.getMap('meta').set('projectId', ID);
  return c;
}
const written = () => m(commitWholeLocalFile).mock.calls.at(-1)?.[0] as { file: string; after: string };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  markFilesTruth(ID);
  m(readLocalFile).mockResolvedValue(PAGE_SRC);
  m(commitWholeLocalFile).mockResolvedValue({ ok: true });
});

describe('pure transforms', () => {
  it('unwrapLinkSource keeps the children in place', () => {
    expect(unwrapLinkSource(PAGE_SRC, { line: 7, column: 3 })).toContain('  <section>B</section>\n  <span>link</span>\n</Main>');
  });
  it('unwrapLinkSource refuses a non-link', () => {
    expect(() => unwrapLinkSource(PAGE_SRC, { line: 5, column: 3 })).toThrow(/not a link/);
  });
  it('detachLayoutSource drops the wrapper + import, keeps the body', () => {
    const out = detachLayoutSource(PAGE_SRC, 'Main');
    expect(out).not.toMatch(/Main/);
    expect(out).toContain('---\n---\n  <section>A</section>');
  });
});

describe('files-truth routing', () => {
  it('reorder_page_elements rewrites the page with the elements swapped', async () => {
    const r = await (generateCommandTools(ctx([el('a', 5), el('b', 6)])) as Tools).reorder_page_elements.execute({ pageId: 'index', elementIds: ['b', 'a'] });
    expect(r.success).toBe(true);
    expect(written().after).toMatch(/<section>B<\/section>\n {2}<section>A<\/section>/);
  });

  it('set_child_order refuses a partial list', async () => {
    const r = await (generateCommandTools(ctx([el('p', 4, 'div'), el('a', 5, 'section', 'p'), el('b', 6, 'section', 'p'), el('c', 7, 'a', 'p')])) as Tools)
      .set_child_order.execute({ pageId: 'index', parentKey: 'p', childKeys: ['b', 'a'] });
    expect(r.success).toBe(false);
    expect(commitWholeLocalFile).not.toHaveBeenCalled();
  });

  it('update_link_attribute writes the attribute into the file', async () => {
    const r = await (generateCommandTools(ctx([el('l', 7, 'a')])) as Tools).update_link_attribute.execute({ elementId: 'l', attribute: 'href', value: '/blog' });
    expect(r.success).toBe(true);
    expect(written().after).toContain('<a href="/blog" class="block">');
  });

  it('unwrap_link writes the unwrapped page', async () => {
    await (generateCommandTools(ctx([el('l', 7, 'a')])) as Tools).unwrap_link.execute({ elementId: 'l' });
    expect(written().after).not.toContain('<a ');
  });

  it('set_layout_props / detach_layout edit the layout tag', async () => {
    const tools = generateCommandTools(ctx()) as Tools;
    await tools.set_layout_props.execute({ pageId: 'index', props: { title: 'Works' } });
    expect(written().after).toContain('<Main title="Works">');
    await tools.detach_layout.execute({ pageId: 'index' });
    expect(written().after).not.toContain('<Main');
  });

  it('apply_layout routes through applyLocalPageLayout', async () => {
    m(applyLocalPageLayout).mockResolvedValue({ ok: true });
    const c = ctx();
    c.layoutLibrary = [{ name: 'Post', path: 'src/layouts/Post.astro' }] as never;
    const r = await (generateCommandTools(c) as Tools).apply_layout.execute({ pageId: 'index', layoutName: 'Post' });
    expect(r.success).toBe(true);
    expect(applyLocalPageLayout).toHaveBeenCalledWith(expect.objectContaining({ component: expect.objectContaining({ path: 'src/layouts/Post.astro' }), pageFile: PAGE }));
  });

  it('set_grid_placement accepts GRID_PLACE_ELEMENT tokens', async () => {
    await (generateCommandTools(ctx([el('g', 5)])) as Tools).set_grid_placement.execute({ key: 'g', gridColumn: '2 / span 2', gridRow: '1' });
    expect(acceptEditorCommands).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ type: 'GRID_PLACE_ELEMENT', key: 'g', gridColumn: 'col-start-2 col-span-2', gridRow: 'row-start-1' })], undefined);
  });

  it('reset_instance / push_instance_to_source use the local master overrides', async () => {
    const key = 'src/components/Card.astro:3:1';
    m(localOverridesForPlacement).mockReturnValue([{ kind: 'classes', key }]);
    m(pushLocalOverridesUndoable).mockResolvedValue({ pushed: 1, failed: 0, reasons: [] });
    const native = vi.spyOn(window, 'confirm');
    const c = ctx();
    const tools = generateCommandTools(c) as Tools;
    expect((await tools.reset_instance.execute({ instanceId: key })).success).toBe(true);
    expect(resetLocalOverrides).toHaveBeenCalled();
    expect(tools.push_instance_to_source).toBeDefined();
    // The DesignBar Push's own undoable path (one ⌘Z), at once — no popup, no confirm param (owner 2026-11-10).
    const pushed = await tools.push_instance_to_source.execute({ instanceId: key });
    expect(pushed.success).toBe(true); expect(pushed.message).toMatch(/⌘Z/);
    expect(pushLocalOverridesUndoable).toHaveBeenCalledWith(c.doc, 'src/components/Card.astro', undefined, c);
    expect(native).not.toHaveBeenCalled();
  });

  it('make_component extracts the element into a component file', async () => {
    m(readLocalElementSource).mockResolvedValue({ source: '<section>A</section>', startLine: 5, endLine: 5 });
    m(insertLocalComponent).mockResolvedValue({ ok: true, file: 'src/components/Hero.astro', insertedLine: 5 });
    const r = await (generateCommandTools(ctx([el('a', 5)])) as Tools).make_component.execute({ key: 'a', name: 'Hero' });
    expect(r.success).toBe(true);
    expect(insertLocalComponent).toHaveBeenCalledWith(expect.objectContaining({ replaceKey: 'a', component: expect.objectContaining({ name: 'Hero', html: '<section>A</section>' }) }));
  });

  it('read_page_content / read_component_content read the files', async () => {
    m(readLocalElementSource).mockResolvedValue({ source: '<section>A</section>', startLine: 5, endLine: 5 });
    const tools = generateCommandTools(ctx([el('a', 5)])) as Tools;
    expect(await tools.read_page_content.execute({ pageId: 'index' })).toMatchObject({ file: PAGE, source: PAGE_SRC, rootElements: [{ key: 'a' }], renderedFiles: [] });
    expect(await tools.read_component_content.execute({ elementId: 'a' })).toMatchObject({ markup: '<section>A</section>' });
  });

  it('export_project zips the project rows', async () => {
    const r = await (generateCommandTools(ctx()) as Tools).export_project.execute({ confirm: true });
    expect(r.success).toBe(true);
    expect(downloadFilesTruthZip).toHaveBeenCalledWith(ID, expect.any(String), expect.anything());
  });

  it('delete_drawn_element deletes through deleteLocalElement; delete_instance_child is hidden', async () => {
    m(deleteLocalElement).mockResolvedValue(true);
    const tools = generateCommandTools(ctx([el('src/pages/index.astro:5:3', 5)]));
    expect((await (tools as Tools).delete_drawn_element.execute({ elementKey: 'src/pages/index.astro:5:3' })).success).toBe(true);
    expect(deleteLocalElement).toHaveBeenCalledWith(expect.objectContaining({ key: 'src/pages/index.astro:5:3' }));
    expect(tools.delete_instance_child).toBeUndefined();
  });
});

// task-270: an agent wrote src/pages/index.astro with write_file ("Created …"),
// then select_page("index") answered "not found" twice — nothing registered the
// page until the project was reopened. Files are truth: the doc follows them.
describe('write_file: a new file under src/pages is a page', () => {
  const write = (c: ReturnType<typeof ctx>, path: string) => (generateCommandTools(c) as Tools).write_file.execute({ path, content: '<html></html>\n' });

  it('registers the page (the id and name seeding gives it), announces it, and names it in the result', async () => {
    m(rewriteLocalFile).mockResolvedValue({ created: true, changed: true });
    const c = ctx();
    const announced: unknown[] = [];
    const listener = (e: Event) => announced.push((e as CustomEvent).detail);
    window.addEventListener('sq:local-page-created', listener);
    const r = await write(c, 'src/pages/about.astro');
    window.removeEventListener('sq:local-page-created', listener);
    expect(r).toMatchObject({ success: true, data: { pageId: 'about' } });
    expect((c.doc.getMap('pages').get('about') as { get(k: string): unknown }).get('name')).toBe('/about');
    expect(c.doc.getArray('rootPages').toArray()).toContain('about');
    expect(announced).toEqual([{ route: '/about', file: 'src/pages/about.astro', editable: true }]);
  });

  it('adds nothing for an overwrite, a file outside src/pages, or a page that already exists', async () => {
    const c = ctx();
    m(rewriteLocalFile).mockResolvedValue({ created: false, changed: true });
    await write(c, 'src/pages/about.astro');
    m(rewriteLocalFile).mockResolvedValue({ created: true, changed: true });
    expect(await write(c, 'src/components/New.astro')).toMatchObject({ success: true, message: 'Created src/components/New.astro' });
    expect(c.doc.getMap('pages').size).toBe(0);
    await write(c, 'src/pages/about.astro');
    await write(c, 'src/pages/about.astro');
    expect(c.doc.getArray('rootPages').toArray()).toEqual(['about']);
  });
});
