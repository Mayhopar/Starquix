/**
 * Instance overrides live in files as props (utils/propOverrides.ts): on a
 * reload the page RENDERS the override. The scan must still read the master
 * (`data-sq-cf` → masterClasses) as the file value, or the first scan of a new
 * session takes the override for the file, retires it, and `*` / Push / Reset
 * disappear while the page prop stays in the files.
 */
import { it, expect, afterEach } from 'vitest';
import { _resetLocalPageSyncForTests, noteLocalAcceptedSourceRevision } from '@/utils/localPageSync';
import * as Y from 'yjs';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { applyCommand } from '@/store/commands';
import { localOverridesForPlacement, localMasterOutdated } from '@/store/localMasterOverrides';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';

const CARD = 'src/components/Card.astro';
const PLACEMENT = 's4db83f82b016cfb0';
const KEY = `${CARD}:4:1~${PLACEMENT}`;
const MASTER = 'card px-4';
const OVERRIDE = 'card px-4 opacity-90';
const scan = (classes: string, masterClasses?: string) => ({ key: KEY, parentKey: null, tagName: 'div', classes, masterClasses, sourceLocation: { file: CARD, line: 4, column: 1 },
  rect: { top: 0, left: 0, width: 10, height: 10 } });
const ctxFor = (doc: Y.Doc) => makeFakeCtx({ refs: { iframe: makeFakeIframe().iframe }, env: { doc } });

afterEach(() => { resetClassWriteBaselines(); _resetLocalPageSyncForTests(); });

function editedOnPage(doc: Y.Doc) {
  handleElementsScanned(ctxFor(doc), { elements: [scan(MASTER)] });
  doc.transact(() => applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: MASTER, sourceLocation: { file: CARD, line: 4, column: 1 } }));
  doc.transact(() => applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: OVERRIDE }));
  // The file write lands: the page passes the prop, the element reads it.
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, MASTER)] });
}

it('a reopened page still counts its file-backed override (*, Push, Reset stay reachable)', () => {
  const doc = new Y.Doc();
  editedOnPage(doc);
  resetClassWriteBaselines(); // new session: in-memory observations are gone
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, MASTER)] });
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT).map(e => e.value)).toEqual([OVERRIDE]);
  expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);
});

it('a master edit under a file-backed override lights ↻', () => {
  const doc = new Y.Doc();
  editedOnPage(doc);
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, 'card px-8')] });
  expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(true);
});

it('an override that exists only in files (imported project) gets its editor entry back', () => {
  const doc = new Y.Doc(); // nothing in the editor store — fresh import
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, MASTER)] });
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT).map(e => e.value)).toEqual([OVERRIDE]);
  expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);
});

it('a page that passes nothing seeds nothing', () => {
  const doc = new Y.Doc();
  handleElementsScanned(ctxFor(doc), { elements: [scan('px-4 card', MASTER)] });
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT)).toEqual([]);
});

it('a text override that exists only in files gets its editor entry back', () => {
  const doc = new Y.Doc();
  handleElementsScanned(ctxFor(doc), { elements: [{ ...scan(MASTER), textContent: 'Projects', masterText: 'Works' }] });
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT).filter(e => e.kind === 'text').map(e => e.value)).toEqual(['Projects']);
  expect(localMasterOutdated(doc, CARD, PLACEMENT)).toBe(false);
  // No override on the page: nothing seeded.
  const clean = new Y.Doc();
  handleElementsScanned(ctxFor(clean), { elements: [{ ...scan(MASTER), textContent: 'Works', masterText: 'Works' }] });
  expect(localOverridesForPlacement(clean, CARD, PLACEMENT)).toEqual([]);
});

it('after Push/Reset, a scan of the not-yet-reloaded page does not re-seed the dropped override', async () => {
  const { settleOverrides } = await import('@/utils/propOverrides');
  const doc = new Y.Doc();
  settleOverrides([{ key: KEY, kind: 'classes' }]); // Reset dropped the page prop; the frame has not reloaded yet
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, MASTER)] });
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT)).toEqual([]);
  handleElementsScanned(ctxFor(doc), { elements: [scan(MASTER, MASTER)] }); // reloaded: settled
  handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE, MASTER)] }); // a later file override seeds again
  expect(localOverridesForPlacement(doc, CARD, PLACEMENT).map(e => e.value)).toEqual([OVERRIDE]);
});

it('a fallback the tagger cannot report (class:list): the master stamped at the edit keeps it an override after reopen', async () => {
  const { stampMasterFileValue } = await import('@/services/durableEdits/propOverrideCommands');
  const edit = (stamp: boolean) => {
    resetClassWriteBaselines();
    const doc = new Y.Doc();
    handleElementsScanned(ctxFor(doc), { elements: [scan(MASTER)] });
    doc.transact(() => applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: KEY, classes: MASTER, sourceLocation: { file: CARD, line: 4, column: 1 } }));
    doc.transact(() => {
      applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: KEY, classes: OVERRIDE });
      if (stamp) stampMasterFileValue(doc, KEY);
    });
    resetClassWriteBaselines(); // reopen
    handleElementsScanned(ctxFor(doc), { elements: [scan(OVERRIDE)] }); // no masterClasses
    return localOverridesForPlacement(doc, CARD, PLACEMENT).length;
  };
  expect(edit(false)).toBe(0); // the bug this guards
  expect(edit(true)).toBe(1);
});

// Owner 2026-10-18: Reset to master on a Feature <img> left `imgSrc` in the page.
const IMG = `${CARD}:9:5~${PLACEMENT}`;
const img = (src: string, usageVersion?: string) => ({ key: IMG, parentKey: null, tagName: 'img', classes: 'w-full', imageSrc: src,
  masterSrc: '/master.webp', sourceLocation: { file: CARD, line: 9, column: 5 },
  usageLocation: { file: 'src/pages/index.astro', line: 19, column: 5, ...(usageVersion ? { sourceVersion: usageVersion } : {}) },
  rect: { top: 0, left: 0, width: 10, height: 10 } });
const imageOverrides = (doc: Y.Doc) => localOverridesForPlacement(doc, CARD, PLACEMENT).filter(e => e.kind === 'image');

it('after Reset of an <img> override, its master class does not end the src settle', async () => {
  const { settleOverrides } = await import('@/utils/propOverrides');
  const doc = new Y.Doc();
  settleOverrides([{ key: IMG, kind: 'image' }]);
  handleElementsScanned(ctxFor(doc), { elements: [img('/uploads/old.jpg')] }); // not reloaded yet
  expect(imageOverrides(doc)).toEqual([]);
  handleElementsScanned(ctxFor(doc), { elements: [img('/master.webp')] }); // reloaded: settled
});

it('a scan of page bytes an accepted write replaced never seeds the dropped override back', () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', 'p1');
  // The drop (Reset / undo / back to the master value): page with the prop → page without it.
  noteLocalAcceptedSourceRevision('p1', 2, [{ kind: 'file-batch', payload: { files: [{ file: 'src/pages/index.astro', beforeSource: 'b', afterSource: 'a',
    identityMaps: [{ id: 'drop', beforeVersion: 'with-prop', afterVersion: 'without-prop', entries: [] }] }] } }]);
  handleElementsScanned(ctxFor(doc), { elements: [img('/uploads/old.jpg', 'with-prop')] });
  expect(imageOverrides(doc)).toEqual([]);
  // Current or unknown bytes (an outside edit) are the files speaking: they seed.
  handleElementsScanned(ctxFor(doc), { elements: [img('/uploads/new.jpg', 'outside-edit')] });
  expect(imageOverrides(doc).map(e => e.value)).toEqual([{ src: '/uploads/new.jpg' }]);
});
