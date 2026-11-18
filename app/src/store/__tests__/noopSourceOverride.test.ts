import { FILE_FIELD, IMAGE_BASE_FIELD, forEachSourceImageAttrsEntry } from '../sourceOverrideEntries';
/**
 * task-186: an override whose value EQUALS its own ↻ anchor is not an edit.
 *
 * Measured in the owner's storage:
 *   "src/components/Header.astro:6:1": { classes: "…bg-white…",
 *                                        baseClasses: "…bg-white…" }
 * `classes === baseClasses` means the user changed nothing, yet the entry was
 * stamped `edited: true`, counted for `*`, re-applied by every scan (painting
 * itself over whatever the file says) and re-serialised to localStorage on
 * every save — permanently. `base === now` also makes ↻ structurally unable to
 * fire, so there was no route out from the UI.
 *
 * The rule already exists for instance children (ClassStoreContext ~line 382:
 * `sameTokenSet` → delete the override rather than store a no-op). This pins
 * the same rule on bare/placement SOURCE keys, applied in THE inert-entry
 * predicate so every consumer (`*`, ↻, Push, scan re-apply, persistence,
 * export) gets it from one place.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { isEditedSourceClassEntry } from '../sourceOverrideEntries';
import { hasLocalMasterOverrides } from '../localMasterOverrides';
import { setClassWriteBaseline, resetClassWriteBaselines } from '@/services/classWriteBaseline';

// node 25's webstorage shadows jsdom's and lacks working methods without
// --localstorage-file (same stub as hooks/__tests__/useSourceOverridesPersistence.test.ts)
const store: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  },
  configurable: true,
});

const KEY = 'src/components/Header.astro:6:1';
const CLASSES = 'w-full bg-white px-6 py-4';

function seed(doc: Y.Doc, classes: string, baseClasses?: string): Y.Map<unknown> {
  const entry = new Y.Map();
  doc.transact(() => {
    doc.getMap('sourceClasses').set(KEY, entry);
    entry.set('classes', classes);
    entry.set('edited', true);
    if (baseClasses !== undefined) entry.set('baseClasses', baseClasses);
  });
  return entry;
}

describe('a source override equal to its own baseline is not an edit', () => {
  it('token order / duplicates do not resurrect it (same predicate as task-102)', () => {
    const doc = new Y.Doc();
    const entry = seed(doc, 'px-6  bg-white w-full py-4', CLASSES);
    expect(isEditedSourceClassEntry(entry)).toBe(false);
  });

  it('an UNANCHORED entry stays an edit — unknown baseline stays unknown', () => {
    const doc = new Y.Doc();
    const entry = seed(doc, CLASSES);
    expect(isEditedSourceClassEntry(entry)).toBe(true);
  });

  // The owner's storage is ALREADY poisoned. Opening the project must heal it,
  // not merely stop creating new ones: restore still reads the entry (nothing
  // is purged behind the user's back) but it lands inert, so the very next
  // debounced save writes it out of the blob.
});

/**
 * task-186 FIX-1 — the OTHER no-op shape: an override equal to what the file
 * NOW renders (not to its own ↻ anchor, so the test above cannot catch it).
 *
 * Measured on a local rig: editing a master through the COMPONENT EDITOR
 * writes the component file (correct) AND leaves a bare-key entry behind —
 *   "src/components/X.astro:6:1": {classes:"…bg-zinc-800…",
 *                                  baseClasses:"…bg-red-400…"}
 * `classes !== baseClasses`, so it reads as a live edit forever. It is
 * pointless the instant the write lands — the file IS that value — and the
 * moment the file moves EXTERNALLY (git checkout, another tool, another
 * session) the entry shadows the file in the component view.
 *
 * The rule: an override equal to what the file NOW renders is not an override.
 * `services/classWriteBaseline.ts` already knows what the file renders, and
 * `isEditedSourceClassEntry` is already THE "is this an edit" predicate — the
 * comparison goes there, so `*`, ↻, Push, scan re-apply, persistence and
 * export all get it from one place. No purge, no KEY_SCHEME change.
 */
describe('a source override equal to what the FILE renders is not an edit', () => {
  afterEach(() => resetClassWriteBaselines());

  const EDITED = 'w-full bg-zinc-800 px-6 py-4';

  it('token order / duplicates do not resurrect it', () => {
    const doc = new Y.Doc();
    const entry = seed(doc, 'px-6  bg-zinc-800 w-full py-4', CLASSES);
    setClassWriteBaseline(KEY, EDITED);
    expect(isEditedSourceClassEntry(entry, KEY)).toBe(false);
  });

  // The guard rail: a doc-overlay edit (WC, and every local cross-file edit the
  // writer declines) never updates the baseline, so the file still renders the
  // PRE-edit value and the override must survive the reload.
  // Unknown file value = unknown: WC never writes a file, so nothing may be
  // inferred from the absence of a baseline.
  it('an unknown file value leaves the entry alone', () => {
    const doc = new Y.Doc();
    const entry = seed(doc, EDITED, CLASSES);
    expect(isEditedSourceClassEntry(entry, KEY)).toBe(true);
    expect(isEditedSourceClassEntry(entry)).toBe(true);
  });
});


/**
 * The image tier's bookkeeping fields are SIBLINGS of real <img> attributes:
 * an entry's other string values are src / alt / loading, which Push writes
 * into the real .astro file, the export pipeline emits, and the iframe sync
 * paints onto the element. `fileAttributes` (the file's own value, task-192)
 * joined `baseAttributes` there, so every consumer that treats those values as
 * attributes must skip it — otherwise it is written out as a literal
 * `fileAttributes="…"` attribute.
 */
describe('image bookkeeping fields are never treated as attributes', () => {
  it('forEachSourceImageAttrsEntry skips both the anchor and the file value', () => {
    const doc = new Y.Doc();
    const KEY = 'src/components/Card.astro:7:3~sabc';
    doc.transact(() => {
      const e = new Y.Map();
      e.set('src', '/img/a.svg');
      e.set(IMAGE_BASE_FIELD, '/img/base.svg');
      e.set(FILE_FIELD.sourceImageAttributes, '/img/file.svg');
      e.set('sourceLocation', (() => {
        const m = new Y.Map();
        m.set('file', 'src/components/Card.astro');
        m.set('line', 7); m.set('column', 3);
        return m;
      })());
      doc.getMap('sourceImageAttributes').set(KEY, e);
    });

    const seen: Record<string, string>[] = [];
    forEachSourceImageAttrsEntry(doc, ({ attributes }) => { seen.push(attributes); });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ src: '/img/a.svg' });
    expect(Object.keys(seen[0])).not.toContain(IMAGE_BASE_FIELD);
    expect(Object.keys(seen[0])).not.toContain(FILE_FIELD.sourceImageAttributes);
  });
});
