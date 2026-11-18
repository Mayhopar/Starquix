/**
 * Link-markup overlay × runtime laws (adversarial-review sweep):
 *
 * 1. LOCAL files-truth: accepted markup retains its document/snapshot carrier
 *    with source ownership metadata. Scan/export never reapply that carrier
 *    over a newer source. Cross-file page overlays remain active when the
 *    master source is outside the write scope. Rejected preparation accepts
 *    neither file nor overlay; a lost ACK cannot invalidate accepted state.
 *
 * 2. Drop visibility: when a plain-text edit drops the markup override (the
 *    ambiguous-edit fallback), the DOM must be flattened NOW — not silently
 *    on some later reload.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';
import { setLocalPageFile, setLocalExpectedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import { getDurableProjectState } from '@/services/durableEdits/store';
import { forEachSourceLinkAttrsEntry } from '@/store/sourceOverrideEntries';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { handleMarkupChanged, handleEditModeExited } from '../textEditing';
import { handleElementsScanned } from '../scanning';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { applyCommand } from '@/store/commands';
import { LINK_MARKUP_FIELD } from '@/store/sourceOverrideEntries';
import { viteTextWriter } from '@/services/ViteTextWriter';
import type { ViewportMessageContext } from '../context';

vi.mock('@/services/ViteTextWriter', () => ({
  viteTextWriter: {
    writeTextUpdate: vi.fn(() => Promise.resolve(true)),
    isAvailable: vi.fn(() => true),
  },
}));

vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: t };
});

beforeEach(() => {
  vi.mocked(viteTextWriter.writeTextUpdate).mockReset();
  vi.mocked(viteTextWriter.writeTextUpdate).mockResolvedValue(true);
  vi.mocked(toast.error).mockClear();
});

const KEY = 'src/pages/index.astro:5:1';
const LOC = { file: 'src/pages/index.astro', line: 5, column: 1 };
const MARKUP = 'Visit <a href="/about">our team</a> today';

const el = (key: string, sourceLocation?: typeof LOC) => ({
  key, parentKey: null, tagName: 'p', classes: '',
  rect: { top: 0, left: 0, width: 10, height: 10 },
  ...(sourceLocation ? { sourceLocation } : {}),
});

function markupOf(doc: Y.Doc, key: string): unknown {
  const entry = doc.getMap('sourceLinkAttributes').get(key) as Y.Map<unknown> | undefined;
  return entry?.get(LINK_MARKUP_FIELD);
}

/** ctx whose dispatch REALLY applies commands to the doc (the fake's default
 *  dispatch is a spy that applies nothing, which would hide the overlay). */
function makeDocCtx(projectId: string | null, extra: Parameters<typeof makeFakeCtx>[0] = {}): {
  ctx: ViewportMessageContext; doc: Y.Doc;
} {
  const doc = new Y.Doc();
  if (projectId) doc.getMap('meta').set('projectId', projectId);
  const ctx = makeFakeCtx({
    ...extra,
    env: { doc, projectId, ...(extra.env ?? {}) },
    actions: {
      dispatch: vi.fn((cmd) => applyCommand(doc, cmd as never)),
      ...(extra.actions ?? {}),
    },
  });
  return { ctx, doc };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('MARKUP_CHANGED in files-truth', () => {
  let projectId: string;
  const original = '<main>\n\n\n\n<p>Visit our team today</p>\n</main>\n';
  let runtime: ReturnType<typeof projectFsRuntime>, release: () => void, loseAck: boolean;
  beforeEach(async () => {
    await db.delete(); await db.open(); projectId = `browser_lf_${crypto.randomUUID()}`; markFilesTruth(projectId); setActiveSaveProjectId(projectId);
    setLocalPageFile(LOC.file); setLocalExpectedRoute('/'); loseAck = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    runtime = projectFsRuntime(projectId, { [LOC.file]: original }, { beforeCommand: () => gate, loseAcknowledgement: () => loseAck });
  });
  afterEach(async () => {
    release(); await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
    runtime.close(); unmarkFilesTruth(projectId); setActiveSaveProjectId(null); _resetLocalPageSyncForTests();
  });
  const renderedOverlays = (doc: Y.Doc) => {
    const entries: unknown[] = []; forEachSourceLinkAttrsEntry(doc, entry => entries.push(entry)); return entries;
  };
  it('retains the accepted carrier without exporting or reapplying it over later file contents', async () => {
    const { ctx, doc } = makeDocCtx(projectId, {
      refs: { scannedElements: { current: [el(KEY, LOC)] } as never },
    });
    const pending = handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    expect(markupOf(doc, KEY)).toBeUndefined();
    await pending;
    expect(markupOf(doc, KEY)).toBe(MARKUP);
    expect(renderedOverlays(doc)).toEqual([]);
    release(); await flushDurableSourceWritesThrough(projectId, 1);
    expect(runtime.read(LOC.file)).toContain(MARKUP);
    expect(renderedOverlays(doc)).toEqual([]);
  });

  it('keeps the overlay when the writer DECLINES (cross-file carrier, task-149)', async () => {
    setLocalPageFile('src/pages/other.astro');
    const { ctx, doc } = makeDocCtx(projectId, {
      refs: { scannedElements: { current: [el(KEY, LOC)] } as never },
    });
    await handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    expect(markupOf(doc, KEY)).toBe(MARKUP);
    expect(renderedOverlays(doc)).toHaveLength(1);
    expect(runtime.read(LOC.file)).toBe(original);
  });

  it('refuses dynamic-expression replacement before publishing an overlay or source intent', async () => {
    writeFileSync(join(runtime.root, LOC.file), original.replace('Visit our team today', '{entry.title}'));
    const { ctx, doc } = makeDocCtx(projectId, {
      refs: { scannedElements: { current: [el(KEY, LOC)] } as never },
    });
    await handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    expect(markupOf(doc, KEY)).toBeUndefined();
    expect(toast.error).toHaveBeenCalled();
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('reconciles a lost source ACK without turning the carrier into a repaint or showing a save toast', async () => {
    loseAck = true;
    const { ctx, doc } = makeDocCtx(projectId, {
      refs: { scannedElements: { current: [el(KEY, LOC)] } as never },
    });
    await handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    release(); await flushDurableSourceWritesThrough(projectId, 1);
    expect(runtime.read(LOC.file)).toContain(MARKUP);
    expect(renderedOverlays(doc)).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('never clears a NEWER wrap stored while an older write was in flight', async () => {
    const { ctx, doc } = makeDocCtx(projectId, {
      refs: { scannedElements: { current: [el(KEY, LOC)] } as never },
    });
    await handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    const newer = 'Visit <a href="/pricing">our team</a> today';
    await handleMarkupChanged(ctx, { key: KEY, innerHTML: newer });
    release(); await flushDurableSourceWritesThrough(projectId, 2);
    expect(markupOf(doc, KEY)).toBe(newer);
    expect(runtime.read(LOC.file)).toContain(newer);
    expect(renderedOverlays(doc)).toEqual([]);
  });
});

describe('MARKUP_CHANGED outside local mode (overlay is THE persistence)', () => {
  it('keeps the overlay in WC/server even when the write resolves true', async () => {
    const { ctx, doc } = makeDocCtx('browser_xyz', {
      refs: { scannedElements: { current: [el(KEY, LOC)] } as never },
    });
    handleMarkupChanged(ctx, { key: KEY, innerHTML: MARKUP });
    await flush();
    expect(markupOf(doc, KEY)).toBe(MARKUP);
  });
});

describe('EDIT_MODE_EXITED after a wrap (drop must be visible NOW)', () => {
  it('flattens the DOM via UPDATE_TEXT when the text edit DROPS the markup override', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const { ctx, doc } = makeDocCtx(null, { refs: { iframe } });
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });

    handleEditModeExited(ctx, {
      key: KEY, textContent: 'Completely new copy', originalText: 'Visit our team today',
    });

    expect(markupOf(doc, KEY)).toBeUndefined(); // ambiguous edit → dropped
    // Before the fix nothing was posted: the DOM kept the <a> until some
    // later reload silently unwrapped it — divergence the user never saw.
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'UPDATE_TEXT', payload: { key: KEY, textContent: 'Completely new copy' } }, '*',
    );
  });

  it('does NOT flatten when the edit was spliced into the markup (wrap persists)', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const { ctx, doc } = makeDocCtx(null, { refs: { iframe } });
    applyCommand(doc, { type: 'UPDATE_SOURCE_MARKUP', sourceKey: KEY, markup: MARKUP });

    handleEditModeExited(ctx, {
      key: KEY, textContent: 'Visit our team tomorrow', originalText: 'Visit our team today',
    });

    expect(markupOf(doc, KEY)).toBe('Visit <a href="/about">our team</a> tomorrow');
    const sent = postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(sent).not.toContain('UPDATE_TEXT');
  });
});
