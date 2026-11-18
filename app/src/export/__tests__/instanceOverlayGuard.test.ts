// @vitest-environment node
import { beforeEach, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { db } from '@/db';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { assertPublishable, buildFilesTruthZip, projectFilesAsArtifacts } from '../filesTruthZip';

const projectId = 'browser_export_guard';
const key = 'src/components/Hero.astro:1:1~s1111111111111111';
const master = '<h1 class="text-left">Original</h1>';
const makeDoc = () => { const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId); return doc; };
const entry = (values: Record<string, unknown>) => new Y.Map(Object.entries(values));
beforeEach(async () => {
  await db.delete(); await db.open();
  await db.projectFiles.put({ id: `${projectId}:src/components/Hero.astro`, projectId,
    path: 'src/components/Hero.astro', content: new TextEncoder().encode(master), isText: true });
});

it.each([
  ['sourceClasses', { edited: true, classes: 'text-center', baseClasses: 'text-left' }],
  ['sourceText', { textContent: 'Accepted edit', baseText: 'Original' }],
  ['sourceImageAttributes', { alt: 'Accepted description' }],
  ['sourceLinkAttributes', { href: '/accepted' }],
  ['sourceLinkAttributes', { sqMarkup: '<a href="/accepted">Accepted</a>' }],
  ['sourceLinkAttributes', { href: '/unpushed', sqMarkup: '<b>Written</b>', sqSourceOwned: '1' }],
] as const)('refuses ZIP and deployment artifacts instead of silently dropping %s placement edits', async (map, values) => {
  const doc = makeDoc(); doc.getMap(map).set(key, entry(values));
  await expect(buildFilesTruthZip(projectId, doc)).rejects.toThrow(/Unpushed component instance edits/);
  await expect(projectFilesAsArtifacts(projectId, 'Project', doc)).rejects.toThrow(/Push.*reset/);
  await expect(assertPublishable(projectId, doc)).rejects.toThrow(/Unpushed component instance edits/); // Cloudflare ledger 38
  expect(new TextDecoder().decode((await db.projectFiles.toArray())[0].content)).toBe(master);
  doc.destroy();
});

it('ignores registration, no-op and source-owned carriers and permits reset without changing source', async () => {
  const doc = makeDoc();
  doc.getMap('sourceClasses').set(key, entry({ classes: 'text-center' }));
  doc.getMap('sourceClasses').set(key + '#2', entry({ edited: true, classes: 'text-left', baseClasses: 'text-left' }));
  doc.getMap('sourceText').set(key, entry({ textContent: 'Accepted', sqSourceOwned: '1' }));
  doc.getMap('sourceImageAttributes').set(key, entry({ alt: 'Accepted', sqSourceOwned: JSON.stringify({ alt: 'Accepted' }) }));
  doc.getMap('sourceLinkAttributes').set(key, entry({ sqMarkup: '<b>Accepted</b>', sqSourceOwned: '1' }));
  const blob = await buildFilesTruthZip(projectId, doc);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  expect(await zip.file('src/components/Hero.astro')!.async('string')).toBe(master);
  doc.getMap('sourceText').set(key, entry({ textContent: 'Unpushed' }));
  await expect(projectFilesAsArtifacts(projectId, 'Project', doc)).rejects.toThrow(/Unpushed/);
  doc.getMap('sourceText').delete(key);
  expect(new TextDecoder().decode((await projectFilesAsArtifacts(projectId, 'Project', doc)).binaries[0].data)).toBe(master);
  await expect(assertPublishable(projectId, doc)).resolves.toBeUndefined();
  doc.destroy();
});

it('joins pending acceptance before deciding whether the export would omit an instance edit', async () => {
  const doc = makeDoc(); let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const accepting = acceptProjectEdit(doc, { projectId, operationId: 'pending-overlay', commands: [],
    prepare: () => wait, mutate: staged => { staged.getMap('sourceText').set(key, entry({ textContent: 'Committed' })); } });
  const exporting = buildFilesTruthZip(projectId, doc);
  const rejected = expect(exporting).rejects.toThrow(/Unpushed/);
  release(); await Promise.all([accepting, rejected]); doc.destroy();
});

it('refuses a mismatched or missing project document instead of inspecting another project', async () => {
  const doc = makeDoc(); doc.getMap('meta').set('projectId', 'browser_other');
  await expect(buildFilesTruthZip(projectId, doc)).rejects.toThrow(/project document/i);
  await expect(projectFilesAsArtifacts(projectId, 'Project', undefined!)).rejects.toThrow(/project document/i);
  doc.destroy();
});

it('an override written into the files as a page prop is exported, not refused (utils/propOverrides.ts)', async () => {
  const propMaster = '<h1 class={Astro.props.h1Class ?? "text-left"}>{Astro.props.h1Text ?? "Original"}</h1>';
  await db.projectFiles.put({ id: `${projectId}:src/components/Hero.astro`, projectId,
    path: 'src/components/Hero.astro', content: new TextEncoder().encode(propMaster), isText: true });
  const doc = makeDoc();
  doc.getMap('sourceClasses').set(key, entry({ edited: true, classes: 'text-center', baseClasses: 'text-left' }));
  doc.getMap('sourceText').set(key, entry({ textContent: 'Page title', baseText: 'Original' }));
  const zip = await JSZip.loadAsync(await (await buildFilesTruthZip(projectId, doc)).arrayBuffer());
  expect(await zip.file('src/components/Hero.astro')!.async('string')).toBe(propMaster);
  // An attribute a prop does not carry (alt on a non-img) is still refused.
  doc.getMap('sourceImageAttributes').set(key, entry({ alt: 'x' }));
  await expect(buildFilesTruthZip(projectId, doc)).rejects.toThrow(/Unpushed/);
  doc.destroy();
});

// Owner run 2026-10-16 (docs/plans/2026-10-16-cloudflare-one-click-design.md): an instance edit keyed to a location the
// file moved away from (lines removed above it) applies to NOTHING on the canvas, cannot be selected to Push/Reset — and
// blocked Publish/Export forever. Shipping without it is exactly what the user sees.
it('an edit whose location no longer starts an element (the file moved on) never blocks; a live one still does', async () => {
  await db.projectFiles.put({ id: `${projectId}:src/components/Card.astro`, projectId, path: 'src/components/Card.astro',
    content: new TextEncoder().encode('---\n---\n<article class="card">\n    <div class="tab">x</div>\n</article>\n'), isText: true });
  const doc = makeDoc();
  const edit = (k: string) => doc.getMap('sourceClasses').set(k, entry({ edited: true, classes: 'card px-16', baseClasses: 'card' }));
  edit('src/components/Card.astro:4:1~s2222222222222222'); // line 4 starts with spaces: the <div> is at column 5
  edit('src/components/Card.astro:40:1~s2222222222222222'); // past the end of the file
  await expect(assertPublishable(projectId, doc)).resolves.toBeUndefined();
  edit('src/components/Card.astro:3:1~s2222222222222222'); // the <article> really starts here (static class: unshippable)
  await expect(assertPublishable(projectId, doc)).rejects.toThrow(/Unpushed component instance edits/);
  doc.destroy();
});

it('an element after non-ASCII text on its line is found by character OR byte column — never mistaken for an orphan', async () => {
  await db.projectFiles.put({ id: `${projectId}:src/components/Note.astro`, projectId, path: 'src/components/Note.astro',
    content: new TextEncoder().encode('<p>Café <b class="x">y</b></p>\n'), isText: true });
  for (const column of [9, 10]) { // "<b" at character 9 / UTF-8 byte 10 ("é" is two bytes)
    const doc = makeDoc();
    doc.getMap('sourceClasses').set(`src/components/Note.astro:1:${column}~s3333333333333333`, entry({ edited: true, classes: 'x y', baseClasses: 'x' }));
    await expect(assertPublishable(projectId, doc)).rejects.toThrow(/Unpushed component instance edits/);
    doc.destroy();
  }
});

it('a multi-line opening tag keyed at the line it ENDS on is a live element and still blocks (ast-updater findOpeningBracket)', async () => {
  await db.projectFiles.put({ id: `${projectId}:src/components/Tab.astro`, projectId, path: 'src/components/Tab.astro',
    content: new TextEncoder().encode('<section\n  class="tab"\n  id="tabs">\n  <p>x</p>\n</section>\n'), isText: true });
  const doc = makeDoc();
  doc.getMap('sourceClasses').set('src/components/Tab.astro:3:1~s4444444444444444', entry({ edited: true, classes: 'tab px-4', baseClasses: 'tab' }));
  await expect(assertPublishable(projectId, doc)).rejects.toThrow(/Unpushed component instance edits/);
  doc.destroy();
});
