import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useSourceImageSync } from './useSourceImageSync';
import { admitLocalSourceScan, setLocalExpectedRoute, _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const writeImageUpdate = vi.fn().mockResolvedValue(true);
const isAvailable = vi.fn().mockReturnValue(true);

vi.mock('@/services/ViteImageWriter', () => ({
  viteImageWriter: {
    writeImageUpdate: (...args: unknown[]) => writeImageUpdate(...args),
    isAvailable: () => isAvailable(),
  },
}));

const IDLE_SAVE_DELAY_MS = 5000;

describe('useSourceImageSync', () => {
  let doc: Y.Doc;
  let isUndoing: boolean;
  let postMessageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new Y.Doc();
    isUndoing = false;
    writeImageUpdate.mockClear();
    isAvailable.mockReturnValue(true);
    postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    postMessageSpy.mockRestore();
    doc.destroy();
  });

  function renderTheHook() {
    return renderHook(() => useSourceImageSync(doc, () => isUndoing));
  }

  function setAttr(key: string, attribute: string, value: string) {
    doc.transact(() => {
      const map = doc.getMap('sourceImageAttributes');
      let entry = map.get(key) as Y.Map<unknown> | undefined;
      if (!entry) {
        entry = new Y.Map();
        map.set(key, entry);
      }
      (entry as Y.Map<unknown>).set(attribute, value);
    });
  }

  it('posts SYNC_IMAGE_ATTR_TO_IFRAME when sourceImageAttributes changes', () => {
    renderTheHook();
    act(() => {
      setAttr('src/Hero.astro:5:1', 'src', '/new.png');
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'SYNC_IMAGE_ATTR_TO_IFRAME',
        payload: { key: 'src/Hero.astro:5:1', attribute: 'src', value: '/new.png' },
      },
      '*'
    );
  });

  it('a scan seed (the files already carry it) is painted, never written back', async () => {
    const { HYDRATE_ORIGIN } = await import('@/store/sourceOverrideEntries');
    renderTheHook();
    act(() => {
      doc.transact(() => {
        const entry = new Y.Map<unknown>();
        doc.getMap('sourceImageAttributes').set('src/Hero.astro:5:1', entry);
        entry.set('src', '/uploads/from-page-prop.jpg');
      }, HYDRATE_ORIGIN);
    });
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'SYNC_IMAGE_ATTR_TO_IFRAME' }), '*');
    expect(writeImageUpdate).not.toHaveBeenCalled();
    act(() => { setAttr('src/Hero.astro:5:1', 'src', '/new.png'); }); // a real edit still writes
    expect(writeImageUpdate).toHaveBeenCalledTimes(1);
  });

  it('a cached override restored at open is painted, never re-written over the files', async () => {
    const { restoreSourceImageAttrs, KEY_SCHEME } = await import('./useSourceOverridesPersistence');
    localStorage.setItem('sq:source-images:p-restore', JSON.stringify({ keyScheme: KEY_SCHEME, entries: { 'src/Hero.astro:5:1': { src: '/uploads/cached.jpg' } } }));
    renderTheHook();
    act(() => { restoreSourceImageAttrs(doc, 'p-restore'); });
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'SYNC_IMAGE_ATTR_TO_IFRAME' }), '*');
    expect(writeImageUpdate).not.toHaveBeenCalled();
    localStorage.removeItem('sq:source-images:p-restore');
  });

  it('writes through ViteImageWriter immediately (no idle delay, no save step)', () => {
    renderTheHook();
    act(() => {
      setAttr('src/Hero.astro:5:1', 'src', '/new.png');
    });

    expect(writeImageUpdate).toHaveBeenCalledTimes(1);
    expect(writeImageUpdate).toHaveBeenCalledWith(
      { file: 'src/Hero.astro', line: 5, column: 1 },
      'src',
      '/new.png', false, { armed: false, pageFile: null }, true, expect.any(String)
    );
  });

  it('persists immediately during undo/redo (bypasses debounce)', () => {
    isUndoing = true;
    renderTheHook();
    act(() => {
      setAttr('src/Hero.astro:5:1', 'src', '/reverted.png');
    });

    expect(writeImageUpdate).toHaveBeenCalledTimes(1);
    expect(writeImageUpdate).toHaveBeenCalledWith(
      { file: 'src/Hero.astro', line: 5, column: 1 },
      'src',
      '/reverted.png', false, { armed: false, pageFile: null }, true, expect.any(String)
    );
  });

  // task-151: an undo that REMOVES the whole entry is "put the image back the
  // way the source renders it". Nothing used to fire here at all — the key just
  // vanished from `current` — so the canvas kept showing the discarded src until
  // a full preview reload. The scan payload cannot supply the answer either: it
  // reports `hasSrc`/`boundAssetPath` and no attribute values whatsoever.
  it('requests the iframe baseline when an entry is REMOVED during undo', () => {
    renderTheHook();
    act(() => {
      setAttr('src/Hero.astro:5:1', 'src', '/mine.png');
      setAttr('src/Hero.astro:5:1', 'alt', 'my alt');
    });
    postMessageSpy.mockClear();

    isUndoing = true;
    act(() => {
      doc.transact(() => doc.getMap('sourceImageAttributes').delete('src/Hero.astro:5:1'));
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'RESTORE_IMAGE_ATTRS_TO_IFRAME',
        payload: { key: 'src/Hero.astro:5:1', attributes: ['src', 'alt'] },
      },
      '*'
    );
  });

  it('a removal OUTSIDE undo does not request a restore (deletes are not undos)', () => {
    renderTheHook();
    act(() => {
      setAttr('src/Hero.astro:5:1', 'src', '/mine.png');
    });
    postMessageSpy.mockClear();

    act(() => {
      doc.transact(() => doc.getMap('sourceImageAttributes').delete('src/Hero.astro:5:1'));
    });

    expect(
      postMessageSpy.mock.calls.filter(
        ([m]) => (m as { type?: string })?.type === 'RESTORE_IMAGE_ATTRS_TO_IFRAME'
      )
    ).toEqual([]);
  });

  /**
   * SILENT DATA LOSS, found 2026-08-05 — the bug this hook is the only
   * load-bearing victim of.
   *
   * In local mode every element a COMPONENT renders carries a placement segment
   * (`~<pqs><16 hex>`, task-149/159/160) and the scanner may add a `#N` repeat
   * counter. `parseSourceLocationFromKey` matched neither, returned null, and
   * both call sites (lines 33 and 89) treat null as an early `return`. Result:
   * the image edit is accepted by the UI, lands in the doc, syncs to the iframe
   * — and NEVER reaches the user's file. No error, no toast, no log; the loss
   * only shows up after a reload, as a reverted image.
   *
   * These assert on the WRITER call, not on the parser, because the writer call
   * is what was missing.
   */
  it('WRITES a placement-scoped image edit (all three id schemes, plus #N)', async () => {
    const keys = [
      'src/components/Hero.astro:5:1~p0188f2e85ea7b276',
      'src/components/Hero.astro:5:1~q0188f2e85ea7b276',
      'src/components/Hero.astro:5:1~s0188f2e85ea7b276',
      'src/components/Hero.astro:5:1~s0188f2e85ea7b276#2',
      'src/components/Hero.astro:5:1#2',
    ];
    renderTheHook();
    await act(async () => {
      for (const key of keys) setAttr(key, 'src', '/uploads/hero.png');
      await Promise.resolve(); await Promise.resolve();
    });

    expect(writeImageUpdate).toHaveBeenCalledTimes(keys.length);
    // The placement is an IDENTITY segment, never part of the file path — what
    // reaches the writer must be a real, writable file:line:column.
    for (const call of writeImageUpdate.mock.calls) {
      expect(call[0]).toEqual({ file: 'src/components/Hero.astro', line: 5, column: 1 });
    }
  });

  it('writes a placement-scoped edit immediately during undo/redo too', () => {
    isUndoing = true;
    renderTheHook();
    act(() => {
      setAttr('src/components/Hero.astro:5:1~s0188f2e85ea7b276', 'alt', 'restored');
    });

    expect(writeImageUpdate).toHaveBeenCalledWith(
      { file: 'src/components/Hero.astro', line: 5, column: 1 },
      'alt',
      'restored', false, { armed: false, pageFile: null }, true, expect.any(String)
    );
  });

  it('does not write when source key cannot be parsed as file:line:column', () => {
    renderTheHook();
    act(() => {
      setAttr('not-a-valid-key', 'src', '/x.png');
      vi.advanceTimersByTime(IDLE_SAVE_DELAY_MS);
    });
    expect(writeImageUpdate).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
  // Desktop repro 2026-10-04: after reorder/draw/insert the upload's src landed
  // on the <a> that sat at the img's coordinate when an earlier gesture left a
  // sourceClasses registration on that key (rev 9). A coordinate key is only an
  // index: a NEW gesture names the element of the current admitted scan.
  it('a new image gesture writes to the current scan identity, not a retained registration at the reused coordinate key', () => {
    _resetLocalPageSyncForTests();
    const key = 'src/pages/index.astro:10:5';
    doc.getMap('meta').set('projectId', 'browser_imgkey');
    doc.transact(() => {
      const entry = new Y.Map<unknown>();
      entry.set('sourceLocation', new Y.Map(Object.entries({ file: 'src/pages/index.astro', line: 10, column: 5, sourceVersion: 'sOLD:646', sourceRevision: 9 })));
      doc.getMap('sourceClasses').set(key, entry);
    });
    setLocalExpectedRoute('/');
    admitLocalSourceScan('browser_imgkey', '/', [{ key, classes: 'mt-4 h-24 w-24',
      sourceLocation: { file: 'src/pages/index.astro', line: 10, column: 5, sourceVersion: 'sNEW:792' } }]);
    renderTheHook();
    act(() => { setAttr(key, 'src', '/uploads/replacement.png'); });
    expect(writeImageUpdate).toHaveBeenCalledTimes(1);
    expect(writeImageUpdate.mock.calls[0][0]).toMatchObject({ file: 'src/pages/index.astro', line: 10, column: 5, sourceVersion: 'sNEW:792' });
    _resetLocalPageSyncForTests();
  });
});
