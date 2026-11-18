import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { UNBOUND_COLLECTION_ID } from '@/core/collections/types';
import type { EditorCommand, ClassData } from '@/store/types';
import { CLIPBOARD_VERSION, type ClipboardEnvelope } from '../envelope';
import { pasteEnvelopeIntoDoc, type PasteDocDeps } from '../pasteDoc';

const emptyClasses = (): ClassData => ({ base: [], sm: [], md: [], lg: [], xl: [], '2xl': [] });

const okFetch = () => vi.fn(async (url: string) => {
  if (String(url).includes('save-component')) {
    return { ok: true, json: async () => ({ success: true }) } as unknown as Response;
  }
  throw new Error(`unexpected fetch ${url}`);
});

function setupDoc(projectId = 'browser_target'): Y.Doc {
  const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-1', name: 'P', rootElementIds: [], children: [] } });
  return doc;
}

function makeDeps(doc: Y.Doc, over: Partial<PasteDocDeps> = {}): PasteDocDeps & {
  dispatch: ReturnType<typeof vi.fn>;
  uploadAsset: ReturnType<typeof vi.fn>;
  transferAsset: ReturnType<typeof vi.fn>;
  toast: ReturnType<typeof vi.fn>;
} {
  let uploadSeq = 0;
  const dispatch = vi.fn((cmd: EditorCommand) => {
    let r = false;
    doc.transact(() => { r = applyCommand(doc, cmd); }, 'user');
    return r;
  });
  return {
    doc,
    pageId: 'page-1',
    targetProjectId: 'browser_target',
    selectedElementId: null,
    dispatch,
    takeSnapshot: vi.fn(),
    toast: vi.fn(),
    uploadAsset: vi.fn(async (_pid: string, file: File) => ({ assetId: `new-${++uploadSeq}`, editorBlobUrl: `blob:${file.name}` })),
    transferAsset: vi.fn(async () => {}),
    ...over,
  } as never;
}

const envelope = (over: Partial<ClipboardEnvelope> = {}): ClipboardEnvelope => ({
  v: CLIPBOARD_VERSION,
  sourceProjectId: 'browser_target',
  roots: [],
  masters: [],
  assets: [],
  ...over,
});

beforeEach(() => vi.stubGlobal('fetch', okFetch()));
afterEach(() => vi.unstubAllGlobals());

describe('pasteEnvelopeIntoDoc', () => {
  it('same-project: re-mints ids, no uploads, places after selected root', async () => {
    const doc = setupDoc();
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'first', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: emptyClasses() } });
    applyCommand(doc, { type: 'ADD_ELEMENT', element: { id: 'second', pageId: 'page-1', parentId: null, index: 1, type: 'frame', classes: emptyClasses() } });
    const deps = makeDeps(doc, { selectedElementId: 'first' });
    const env = envelope({
      roots: [{
        label: 'Box', html: '<div class="box">b</div>',
        doc: {
          kind: 'subtree',
          elements: [
            { id: 'drawn-old', pageId: 'page-src', parentId: null, index: 0, type: 'frame', classes: emptyClasses(), extraFields: { isDrawn: true, tag: 'div' } },
            { id: 'drawn-kid', pageId: 'page-src', parentId: 'drawn-old', index: 0, type: 'text', textContent: 'hi', classes: emptyClasses(), extraFields: { isDrawn: true, tag: 'p' } },
          ],
        },
      }],
    });
    const ok = await pasteEnvelopeIntoDoc(env, deps);
    expect(ok).toBe(true);
    expect(deps.uploadAsset).not.toHaveBeenCalled();
    const rootIds = ((doc.getMap('pages').get('page-1') as Y.Map<unknown>).get('rootElementIds') as Y.Array<string>).toArray();
    expect(rootIds).toHaveLength(3);
    expect(rootIds[0]).toBe('first');
    expect(rootIds[2]).toBe('second');            // pasted root landed between: after selected
    const newRootId = rootIds[1];
    expect(newRootId).not.toBe('drawn-old');      // re-minted
    expect(doc.getMap('elements').has('drawn-old')).toBe(false);
    const kidEntry = [...(doc.getMap('elements').keys())].find(k => (doc.getMap('elements').get(k) as Y.Map<unknown>).get('parentId') === newRootId);
    expect(kidEntry).toBeDefined();               // parent link remapped to the new id
  });

  it('cross-project: uploads each embedded asset and rewrites refs in staticMarkup', async () => {
    const doc = setupDoc();
    const deps = makeDeps(doc);
    const env = envelope({
      sourceProjectId: 'browser_other',
      roots: [{ label: 'Img', html: '<img src="sq-asset:old-a">' }],
      assets: [{ assetId: 'old-a', mime: 'image/png', name: 'a.png', base64: 'AQID' }],
    });
    await pasteEnvelopeIntoDoc(env, deps);
    expect(deps.uploadAsset).toHaveBeenCalledTimes(1);
    expect(deps.transferAsset).toHaveBeenCalledTimes(1);
    const cmd = deps.dispatch.mock.calls[0][0] as Extract<EditorCommand, { type: 'PASTE_ELEMENTS' }>;
    expect(cmd.elements[0].element.staticMarkup).toContain('sq-asset:new-1');
    expect(cmd.elements[0].element.staticMarkup).not.toContain('sq-asset:old-a');
  });

  it('masters: identical dropped, missing passed, collision suffixed + instance repointed', async () => {
    const doc = setupDoc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'library/Same.astro', markup: '<div data-sq-id="abc123">same</div>' });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'library/Hero.astro', markup: '<div>target version</div>' });
    const deps = makeDeps(doc);
    const env = envelope({
      sourceProjectId: 'browser_other',
      roots: [
        {
          label: 'Same', html: '<div>same</div>',
          doc: { kind: 'instance', element: { id: 'el-s', pageId: 'p', parentId: null, index: 0, type: 'component', componentType: 'Same', astroSource: 'library/Same.astro', classes: emptyClasses() } },
        },
        {
          label: 'Hero', html: '<div>incoming</div>',
          doc: { kind: 'instance', element: { id: 'el-h', pageId: 'p', parentId: null, index: 1, type: 'component', componentType: 'Hero', astroSource: 'library/Hero.astro', classes: emptyClasses() } },
        },
        {
          label: 'Fresh', html: '<div>fresh</div>',
          doc: { kind: 'instance', element: { id: 'el-f', pageId: 'p', parentId: null, index: 2, type: 'component', componentType: 'Fresh', astroSource: 'library/Fresh.astro', classes: emptyClasses() } },
        },
      ],
      masters: [
        { astroSource: 'library/Same.astro', markup: '<div data-sq-id="zzz999">same</div>', componentType: 'Same' },  // identical modulo sq-ids
        { astroSource: 'library/Hero.astro', markup: '<div>incoming version</div>', componentType: 'Hero' },          // collision
        { astroSource: 'library/Fresh.astro', markup: '<div>fresh</div>', componentType: 'Fresh' },                   // missing
      ],
    });
    await pasteEnvelopeIntoDoc(env, deps);
    const cmd = deps.dispatch.mock.calls[0][0] as Extract<EditorCommand, { type: 'PASTE_ELEMENTS' }>;
    const sources = cmd.masters.map(m => m.astroSource).sort();
    expect(sources).toEqual(['library/Fresh.astro', 'library/Hero2.astro']);
    const heroEntry = cmd.elements.find(e => e.element.componentType === 'Hero2');
    expect(heroEntry?.element.astroSource).toBe('library/Hero2.astro');
    const sameEntry = cmd.elements.find(e => e.element.componentType === 'Same');
    expect(sameEntry?.element.astroSource).toBe('library/Same.astro'); // reused, untouched
  });

  it('cross-project blogSlot resets collectionId to UNBOUND', async () => {
    const doc = setupDoc();
    const deps = makeDeps(doc);
    const env = envelope({
      sourceProjectId: 'browser_other',
      roots: [{
        label: 'Blog', html: '<div>blog</div>',
        doc: {
          kind: 'instance',
          element: { id: 'el-b', pageId: 'p', parentId: null, index: 0, type: 'component', componentType: 'BlogSlot', staticMarkup: '<div/>', classes: emptyClasses() },
          blogSlot: { collectionId: 'col-src', settings: { limit: 3 }, bindings: { 'el-b:h2-0': 'title' } },
        },
      }],
    });
    await pasteEnvelopeIntoDoc(env, deps);
    const cmd = deps.dispatch.mock.calls[0][0] as Extract<EditorCommand, { type: 'PASTE_ELEMENTS' }>;
    const entry = cmd.elements[0];
    expect(entry.blogSlot?.collectionId).toBe(UNBOUND_COLLECTION_ID);
    const newId = entry.element.id;
    expect(Object.keys(entry.blogSlot!.bindings)).toEqual([`${newId}:h2-0`]); // bindings rekeyed
  });

  it('html-only root becomes a staticMarkup element with no astroSource', async () => {
    const doc = setupDoc();
    const deps = makeDeps(doc);
    const env = envelope({ roots: [{ label: 'section', html: '<section class="p-4">s</section>' }] });
    await pasteEnvelopeIntoDoc(env, deps);
    const cmd = deps.dispatch.mock.calls[0][0] as Extract<EditorCommand, { type: 'PASTE_ELEMENTS' }>;
    expect(cmd.elements).toHaveLength(1);
    expect(cmd.elements[0].element.staticMarkup).toContain('p-4');
    expect(cmd.elements[0].element.astroSource).toBeUndefined();
    expect(cmd.elements[0].element.componentType).toBe('Pasted');
  });

  it('base64:null assets are not uploaded and are counted in a toast', async () => {
    const doc = setupDoc();
    const deps = makeDeps(doc);
    const env = envelope({
      sourceProjectId: 'browser_other',
      roots: [{ label: 'Img', html: '<img src="sq-asset:big-one">' }],
      assets: [{ assetId: 'big-one', mime: 'image/png', name: 'big.png', base64: null }],
    });
    await pasteEnvelopeIntoDoc(env, deps);
    expect(deps.uploadAsset).not.toHaveBeenCalled();
    expect(deps.toast).toHaveBeenCalledWith(expect.stringContaining('too large'));
  });
});
