// Durable contract (7932857b): pushOverridesToSource accepts one receipted
// `source-batch` command per routed source (the former POST
// /__sq/write-back-component bodies) and materializes it in the browser
// against the project disk. Routing is asserted on the accepted command
// payloads; the write itself on the real route table (projectFsRuntime).
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { PartialSourceMaterialization } from '@/services/durableEdits/sourceMaterialization';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { pushOverridesToSource, type SourceWritePayload } from '../pushOverridesToSource';
import { applyCommand } from '@/store/commands';
import { emptyClassData } from '@/store/types';

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | null = null;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_push_routing_${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId);
});
afterEach(() => { runtime?.close(); runtime = null; setActiveSaveProjectId(null); vi.unstubAllGlobals(); });

/** Project disk keyed by astroSource (`library/X.astro` → src/components/library/X.astro). */
function disk(sources: Record<string, string>) {
  runtime = projectFsRuntime(projectId, Object.fromEntries(Object.entries(sources)
    .map(([src, text]) => [`src/components/${src}`, text])));
  return runtime;
}

function projectDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  return doc;
}

/** The accepted write-back payloads that carry overrides (≙ the former POST bodies). */
async function writeBacks(): Promise<SourceWritePayload[]> {
  const rows = (await db.durableEdits.where('projectId').equals(projectId).toArray()).sort((a, b) => a.revision - b.revision);
  return rows.flatMap(row => row.commands)
    .flatMap(command => command.kind === 'source-batch' ? command.payload.payloads : [])
    .filter(payload => Object.values(payload.overrides).some(value =>
      Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' && Object.keys(value).length > 0));
}

function seedEditorEl(
  doc: Y.Doc,
  id: string,
  pageId: string,
  astroSource: string,
  staticMarkup: string,
  classOverrides: Record<string, Record<string, string[]>>,
) {
  applyCommand(doc, { type: 'ADD_PAGE', page: {
    id: pageId, name: 'P', rootElementIds: [], children: [],
  }});
  applyCommand(doc, { type: 'ADD_ELEMENT', element: {
    id, pageId, parentId: null, index: 0,
    type: 'component',
    astroSource,
    staticMarkup,
    classes: emptyClassData(),
  }});
  // ADD_ELEMENT stamps data-keys into staticMarkup using `id` as the prefix —
  // but our test fixtures already include the correct prefix. Overwrite with
  // the literal markup we want under test.
  const yEl = doc.getMap('elements').get(id) as Y.Map<unknown>;
  yEl.set('staticMarkup', staticMarkup);

  // Seed classOverrides directly (bypassing UPDATE_THEME_INSTANCE_CLASS_OVERRIDE).
  const yOverrides = new Y.Map<Y.Map<Y.Array<string>>>();
  for (const [sel, bps] of Object.entries(classOverrides)) {
    const selMap = new Y.Map<Y.Array<string>>();
    for (const [bp, classes] of Object.entries(bps)) {
      const arr = new Y.Array<string>();
      arr.push(classes);
      selMap.set(bp, arr);
    }
    yOverrides.set(sel, selMap);
  }
  yEl.set('classOverrides', yOverrides);
}

describe('pushOverridesToSource — per-source routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a Header-internal override to Header.astro, not BlogPost.astro', async () => {
    const doc = projectDoc();
    const headerSrc = 'library/Header.astro';
    const blogSrc = 'library/BlogPost.astro';
    const fs = disk({ [headerSrc]: '<header>\n  <a>Features</a>\n</header>\n', [blogSrc]: '<Header />\n' });
    const staticMarkup = `
      <header data-sq-component-src="${headerSrc}" data-key="el-1:header-0">
        <a data-key="el-1:a-0">Features</a>
      </header>
    `;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {
      'a-0': { base: ['text-red-500'] },
    });

    await pushOverridesToSource(doc, 'el-1');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].astroSource).toBe(headerSrc);
    expect(payloads[0].overrides.classOverrides).toEqual({ 'a-0': 'text-red-500' });
    expect(fs.read(`src/components/${headerSrc}`)).toContain('<a class="text-red-500">Features</a>');
    expect(fs.read(`src/components/${blogSrc}`)).toBe('<Header />\n');
  });

  it('splits a mixed override set into one call per source, in parallel', async () => {
    const doc = projectDoc();
    const headerSrc = 'library/Header.astro';
    const footerSrc = 'library/Footer.astro';
    const blogSrc = 'library/BlogPost.astro';
    const fs = disk({
      [headerSrc]: '<header>\n  <a>Features</a>\n</header>\n',
      [footerSrc]: '<footer>\n  <a>Privacy</a>\n</footer>\n',
      [blogSrc]: '<Header />\n<div></div>\n<Footer />\n',
    });
    const staticMarkup = `
      <header data-sq-component-src="${headerSrc}" data-key="el-1:header-0">
        <a data-key="el-1:a-0">Features</a>
      </header>
      <div data-key="el-1:div-0"></div>
      <footer data-sq-component-src="${footerSrc}" data-key="el-1:footer-0">
        <a data-key="el-1:a-1">Privacy</a>
      </footer>
    `;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {
      'a-0':   { base: ['text-red-500'] },  // Header
      'div-0': { base: ['bg-blue-100'] },   // BlogPost
      'a-1':   { base: ['underline'] },     // Footer (after recount → a-0)
    });

    await pushOverridesToSource(doc, 'el-1');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(3);

    const bySrc = new Map<string, unknown>();
    for (const payload of payloads) bySrc.set(payload.astroSource, payload.overrides.classOverrides);
    expect(bySrc.get(headerSrc)).toEqual({ 'a-0': 'text-red-500' });
    expect(bySrc.get(footerSrc)).toEqual({ 'a-0': 'underline' });
    expect(bySrc.get(blogSrc)).toEqual({ 'div-0': 'bg-blue-100' });
    expect(fs.read(`src/components/${footerSrc}`)).toContain('<a class="underline">Privacy</a>');
    expect(fs.read(`src/components/${blogSrc}`)).toContain('<div class="bg-blue-100"></div>');
  });

  it('routes a deletedSelector targeting an inlined component subRoot to the page-template as cta-N', async () => {
    const doc = projectDoc();
    const blogSrc = 'library/BlogPost.astro';
    const ctaSrc = 'library/CTA.astro';
    const fs = disk({
      [blogSrc]: '---\nimport CTA from "./CTA.astro";\n---\n<div>\n  <CTA />\n  <p>Keep</p>\n</div>\n',
      [ctaSrc]: '<section>\n  <h2>Sign up</h2>\n</section>\n',
    });
    const staticMarkup = `
      <section data-sq-component-src="${ctaSrc}" data-key="el-1:section-0">
        <h2 data-key="el-1:h2-0">Sign up</h2>
      </section>
    `;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {});
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
    const yDeleted = new Y.Array<string>();
    yDeleted.push(['section-0']);
    yEl.set('deletedSelectors', yDeleted);

    await pushOverridesToSource(doc, 'el-1');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].astroSource).toBe(blogSrc);
    expect(payloads[0].overrides.deletedSelectors).toEqual(['cta-0']);
    // Critical: the CTA source must NOT receive a write-back.
    expect(payloads.map(p => p.astroSource)).not.toContain(ctaSrc);
    expect(fs.read(`src/components/${ctaSrc}`)).toBe('<section>\n  <h2>Sign up</h2>\n</section>\n');
    expect(fs.read(`src/components/${blogSrc}`)).not.toContain('<CTA />');
  });

  it('drops a deletedSelector that targets a mid-tree element inside an inlined component, with a warn', async () => {
    const doc = projectDoc();
    const blogSrc = 'library/BlogPost.astro';
    const ctaSrc = 'library/CTA.astro';
    disk({ [blogSrc]: '<CTA />\n', [ctaSrc]: '<section>\n  <h2>Sign up</h2>\n</section>\n' });
    const staticMarkup = `
      <section data-sq-component-src="${ctaSrc}" data-key="el-1:section-0">
        <h2 data-key="el-1:h2-0">Sign up</h2>
      </section>
    `;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {});
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
    const yDeleted = new Y.Array<string>();
    yDeleted.push(['h2-0']);
    yEl.set('deletedSelectors', yDeleted);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The rejection is retained as a partial (see the PushResult contract below).
    await expect(pushOverridesToSource(doc, 'el-1')).rejects.toBeInstanceOf(PartialSourceMaterialization);

    // No bucket has content (only rejected delete + no other overrides) → no write-back.
    expect(await writeBacks()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    const warnMsgs = warnSpy.mock.calls.map(c => String(c[0]) + ' ' + String(c[1] ?? ''));
    expect(warnMsgs.some(m => m.includes('inside-component'))).toBe(true);
  });

  it('deletes a page-template-native tag against the page-template source (unchanged behavior)', async () => {
    const doc = projectDoc();
    const blogSrc = 'library/BlogPost.astro';
    const fs = disk({ [blogSrc]: '<main>\n  <div></div>\n  <p>Keep</p>\n</main>\n' });
    const staticMarkup = `<div data-key="el-1:div-0"></div>`;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {});
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
    const yDeleted = new Y.Array<string>();
    yDeleted.push(['div-0']);
    yEl.set('deletedSelectors', yDeleted);

    await pushOverridesToSource(doc, 'el-1');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].astroSource).toBe(blogSrc);
    expect(payloads[0].overrides.deletedSelectors).toEqual(['div-0']);
    expect(fs.read(`src/components/${blogSrc}`)).not.toContain('<div>');
  });

  it('routes a slot-name attributeOverride to the layout source and keeps an empty value (= remove)', async () => {
    const doc = projectDoc();
    const layoutSrc = 'library/Marketing.astro';
    const fs = disk({ [layoutSrc]: '<div>\n  <slot></slot>\n  <slot name="footer"></slot>\n</div>\n' });
    const staticMarkup = `
      <div data-key="el-1:div-0">
        <slot data-key="el-1:slot-0"></slot>
        <slot data-key="el-1:slot-1"></slot>
      </div>
    `;
    seedEditorEl(doc, 'el-1', 'page-1', layoutSrc, staticMarkup, {});
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;

    // attributeOverrides: Y.Map<selector, Y.Map<attr, value>>
    const yAttrs = new Y.Map<Y.Map<string>>();
    const slot0 = new Y.Map<string>();
    slot0.set('name', 'header'); // set a name on the first slot
    yAttrs.set('slot-0', slot0);
    const slot1 = new Y.Map<string>();
    slot1.set('name', ''); // clear the second slot's name (back to default)
    yAttrs.set('slot-1', slot1);
    yEl.set('attributeOverrides', yAttrs);

    await pushOverridesToSource(doc, 'el-1');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].astroSource).toBe(layoutSrc);
    expect(payloads[0].overrides.attributeOverrides).toEqual({
      'slot-0': { name: 'header' },
      'slot-1': { name: '' }, // empty kept → the transform removes the attribute
    });
    const written = fs.read(`src/components/${layoutSrc}`);
    expect(written).toContain('<slot name="header">');
    expect(written).not.toContain('name="footer"');
  });

  it('routes orderOverrides to the page-template source, NOT marker-bucketed across sub-components', async () => {
    // Regression: reordering Header/Footer inside BlogPost editor was
    // bucketing `header-0` into Header.astro and `footer-0` into Footer.astro
    // (via the resolveOverrideSource marker walk). Neither file contains the
    // OTHER tag, so the server's reorder logic was a no-op in both — BlogPost
    // on disk stayed unchanged. Reorder is a sibling relationship in the
    // page-template parent, so it must always route to the page-template
    // source as a single bucket.
    const doc = projectDoc();
    const blogSrc = 'library/BlogPost.astro';
    const headerSrc = 'library/Header.astro';
    const footerSrc = 'library/Footer.astro';
    disk({ [blogSrc]: '<header></header>\n<footer></footer>\n', [headerSrc]: '<header></header>\n', [footerSrc]: '<footer></footer>\n' });
    const staticMarkup = `
      <header data-sq-component-src="${headerSrc}" data-key="el-1:header-0"></header>
      <footer data-sq-component-src="${footerSrc}" data-key="el-1:footer-0"></footer>
    `;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {});
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
    const yOrder = new Y.Array<string>();
    yOrder.push(['footer-0', 'header-0']);
    yEl.set('orderOverrides', yOrder);

    await pushOverridesToSource(doc, 'el-1');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].astroSource).toBe(blogSrc);
    expect(payloads[0].overrides.orderOverrides).toEqual(['footer-0', 'header-0']);
  });

  it('emits reparentOverrides (decoded child>parent, empty = null root) to the editor source', async () => {
    const doc = projectDoc();
    const heroSrc = 'library/Hero.astro';
    const fs = disk({ [heroSrc]: '<div>\n  <section></section>\n  <p>x</p>\n  <span>y</span>\n</div>\n' });
    seedEditorEl(doc, 'el-1', 'page-1', heroSrc, '<div data-key="el-1:div-0"></div>', {});
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
    const yReparent = new Y.Array<string>();
    yReparent.push(['p-0>section-0', 'span-0>']); // span-0 → root
    yEl.set('reparentOverrides', yReparent);

    await pushOverridesToSource(doc, 'el-1');

    const payloads = await writeBacks();
    expect(payloads).toHaveLength(1);
    expect(payloads[0].astroSource).toBe(heroSrc);
    expect(payloads[0].overrides.reparentOverrides).toEqual([
      { selector: 'p-0', newParentSelector: 'section-0' },
      { selector: 'span-0', newParentSelector: null },
    ]);
    expect(fs.read(`src/components/${heroSrc}`)).toMatch(/<section>\s*<p>x<\/p>\s*<\/section>/);
  });
});

// Since 7932857b a write that lands only partly is NOT a resolved PushResult
// with a `skipped` list: the command is retained and the flush rejects with
// PartialSourceMaterialization, whose `skipped` carries the same entries
// (transform report + client-side resolveDeleteTarget rejections).
describe('pushOverridesToSource — PushResult contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates skipped selectors from the write-back report across buckets', async () => {
    const doc = projectDoc();
    const blogSrc = 'library/BlogPost.astro';
    const fs = disk({ [blogSrc]: '<div></div>\n' });
    const staticMarkup = `<div data-key="el-1:div-0"></div>`;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {
      'div-0': { base: ['bg-blue-100'] },
      'h1-9': { base: ['text-6xl'] }, // no such element in the source → unresolved
    });

    const error = await pushOverridesToSource(doc, 'el-1').then(() => null, e => e);
    expect(error).toBeInstanceOf(PartialSourceMaterialization);
    expect((error as PartialSourceMaterialization).skipped).toEqual([
      expect.objectContaining({ source: blogSrc, category: 'classes', selector: 'h1-9', reason: 'unresolved' }),
    ]);
    // The resolved part still reached the source.
    expect(fs.read(`src/components/${blogSrc}`)).toContain('<div class="bg-blue-100"></div>');
  });

  it('records client-side resolveDeleteTarget rejections in skipped', async () => {
    const doc = projectDoc();
    const blogSrc = 'library/BlogPost.astro';
    const ctaSrc = 'library/CTA.astro';
    const fs = disk({ [blogSrc]: '<CTA />\n', [ctaSrc]: '<section>\n  <h2>Sign up</h2>\n</section>\n' });
    const staticMarkup = `
      <section data-sq-component-src="${ctaSrc}" data-key="el-1:section-0">
        <h2 data-key="el-1:h2-0">Sign up</h2>
      </section>
    `;
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, staticMarkup, {});
    const yEl = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
    const yDeleted = new Y.Array<string>();
    yDeleted.push(['h2-0']);
    yEl.set('deletedSelectors', yDeleted);

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const error = await pushOverridesToSource(doc, 'el-1').then(() => null, e => e);
    expect(error).toBeInstanceOf(PartialSourceMaterialization);
    expect((error as PartialSourceMaterialization).skipped).toEqual([
      expect.objectContaining({ source: blogSrc, category: 'deletes', selector: 'h2-0', reason: 'inside-component' }),
    ]);
    // The rejected delete must stay ABSENT from any written payload.
    expect(await writeBacks()).toHaveLength(0);
    expect(fs.read(`src/components/${ctaSrc}`)).toBe('<section>\n  <h2>Sign up</h2>\n</section>\n');
  });

  it('no-op flush (no overrides) returns empty result, not null', async () => {
    const doc = projectDoc();
    const blogSrc = 'library/BlogPost.astro';
    seedEditorEl(doc, 'el-1', 'page-1', blogSrc, `<div data-key="el-1:div-0"></div>`, {});

    const result = await pushOverridesToSource(doc, 'el-1');
    expect(result).toEqual({ astroSource: blogSrc, skipped: [], appliedTotal: 0 });
  });
});
