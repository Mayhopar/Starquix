/**
 * Harness tests for the unified instance-override observer (godfile
 * decomposition Phase C3). Mirrors useSourceImageSync.test.ts: mount the
 * hook, mutate a REAL Y.Doc, assert window.postMessage sync traffic +
 * counter bumps + undo-restore behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useInstanceOverrideSync } from '../useInstanceOverrideSync';

const MARKUP = '<section class="hero p-4"><p>Original text</p><img src="/orig.png" alt="orig" /></section>';

let doc: Y.Doc;
let postSpy: ReturnType<typeof vi.spyOn>;

function addInstance(elementId: string) {
  const elements = doc.getMap('elements');
  doc.transact(() => {
    const el = new Y.Map();
    elements.set(elementId, el);
    el.set('staticMarkup', MARKUP);
  }, 'user');
}

function messagesOfType(type: string) {
  return postSpy.mock.calls
    .map(c => c[0] as { type: string; payload: Record<string, unknown> })
    .filter(m => m?.type === type)
    .map(m => m.payload);
}

beforeEach(() => {
  doc = new Y.Doc();
  postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});

afterEach(() => {
  postSpy.mockRestore();
  doc.destroy();
});

describe('useInstanceOverrideSync', () => {
  it('bumps only for override-relevant changes (task-120 gate)', () => {
    const bump = vi.fn();
    renderHook(() => useInstanceOverrideSync(doc, bump));
    // Plain add (staticMarkup only, no override keys) → no bump
    addInstance('el-1');
    expect(bump).not.toHaveBeenCalled();
    // Override write → bump
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      el.set('classOverrides', new Y.Map());
    }, 'user');
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('class override change posts SYNC_CLASSES_TO_IFRAME with the authoritative override (replace, not merge)', () => {
    renderHook(() => useInstanceOverrideSync(doc, vi.fn()));
    addInstance('el-1');
    postSpy.mockClear();

    // The override is the FULL intended class set. The live sync must REPLACE
    // the element's classes with it — NOT union with the original markup —
    // otherwise a class the user deleted is re-added to the iframe (task-082).
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      const classOverrides = new Y.Map();
      el.set('classOverrides', classOverrides);
      const override = new Y.Map();
      classOverrides.set('section-0', override);
      const base = new Y.Array<string>();
      // Full set minus 'hero' — i.e. the user deleted 'hero'.
      base.insert(0, ['p-4', 'bg-red-500']);
      override.set('base', base);
    }, 'user');

    const msgs = messagesOfType('SYNC_CLASSES_TO_IFRAME');
    const last = msgs[msgs.length - 1].classes as string;
    expect(last).toContain('bg-red-500');
    expect(last).toContain('p-4');
    // The deleted base class is NOT re-merged from the original markup.
    expect(last).not.toContain('hero');
  });

  it('resolves the original classes from the masters overlay, not the stale staticMarkup (task-082)', () => {
    renderHook(() => useInstanceOverrideSync(doc, vi.fn()));

    // Instance with a master overlay whose markup dropped `ring-8` that the
    // (stale, WC-scanned) staticMarkup still carries. Removing the override
    // makes the sync restore the ORIGINAL classes — which must come from the
    // overlay (baseMarkup), not the stale staticMarkup.
    doc.transact(() => {
      const el = new Y.Map();
      doc.getMap('elements').set('el-2', el);
      el.set('staticMarkup', '<section class="hero ring-8" data-key="el-2:section-0"></section>');
      el.set('astroSource', 'library/Hero.astro');
      const m = new Y.Map();
      m.set('markup', '<section class="hero" data-key="baked:section-0"></section>');
      doc.getMap('masters').set('library/Hero.astro', m);
      const co = new Y.Map();
      el.set('classOverrides', co);
      const ov = new Y.Map();
      co.set('section-0', ov);
      const base = new Y.Array<string>();
      base.insert(0, ['hero', 'extra']);
      ov.set('base', base);
    }, 'user');
    postSpy.mockClear();

    // Remove the override → restore branch posts the original (overlay) classes.
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-2') as Y.Map<unknown>;
      (el.get('classOverrides') as Y.Map<unknown>).delete('section-0');
    }, 'user');

    const msgs = messagesOfType('SYNC_CLASSES_TO_IFRAME').filter(p => p.key === 'el-2:section-0');
    const last = msgs[msgs.length - 1].classes as string;
    expect(last).toContain('hero');
    expect(last).not.toContain('ring-8');
  });

  it('text override change posts SYNC_TEXT_TO_IFRAME', () => {
    renderHook(() => useInstanceOverrideSync(doc, vi.fn()));
    addInstance('el-1');
    postSpy.mockClear();

    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      const textOverrides = new Y.Map();
      el.set('textOverrides', textOverrides);
      textOverrides.set('p-0', 'New text');
    }, 'user');

    expect(messagesOfType('SYNC_TEXT_TO_IFRAME')).toContainEqual({
      key: 'el-1:p-0', textContent: 'New text',
    });
  });

  it('removing a text override (undo) restores the original text from staticMarkup', () => {
    renderHook(() => useInstanceOverrideSync(doc, vi.fn()));
    addInstance('el-1');
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      const textOverrides = new Y.Map();
      el.set('textOverrides', textOverrides);
      textOverrides.set('p-0', 'New text');
    }, 'user');
    postSpy.mockClear();

    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      (el.get('textOverrides') as Y.Map<string>).delete('p-0');
    }, 'undo');

    expect(messagesOfType('SYNC_TEXT_TO_IFRAME')).toContainEqual({
      key: 'el-1:p-0', textContent: 'Original text',
    });
  });

  it('instance-child image override posts SYNC_IMAGE_ATTR_TO_IFRAME, and its removal restores the original attribute', () => {
    renderHook(() => useInstanceOverrideSync(doc, vi.fn()));
    addInstance('el-1');
    postSpy.mockClear();

    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      const imageOverrides = new Y.Map();
      el.set('imageOverrides', imageOverrides);
      const attrs = new Y.Map();
      imageOverrides.set('img-0', attrs);
      attrs.set('src', '/new.png');
    }, 'user');

    expect(messagesOfType('SYNC_IMAGE_ATTR_TO_IFRAME')).toContainEqual({
      key: 'el-1:img-0', attribute: 'src', value: '/new.png',
    });

    postSpy.mockClear();
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      (el.get('imageOverrides') as Y.Map<Y.Map<unknown>>).delete('img-0');
    }, 'undo');

    expect(messagesOfType('SYNC_IMAGE_ATTR_TO_IFRAME')).toContainEqual({
      key: 'el-1:img-0', attribute: 'src', value: '/orig.png',
    });
  });

  it('sq:iframe-ready triggers a full re-sync sweep (all instances re-emitted)', () => {
    renderHook(() => useInstanceOverrideSync(doc, vi.fn()));
    addInstance('el-1');
    doc.transact(() => {
      const el = doc.getMap('elements').get('el-1') as Y.Map<unknown>;
      const textOverrides = new Y.Map();
      el.set('textOverrides', textOverrides);
      textOverrides.set('p-0', 'New text');
    }, 'user');
    postSpy.mockClear();

    window.dispatchEvent(new CustomEvent('sq:iframe-ready'));

    expect(messagesOfType('SYNC_TEXT_TO_IFRAME')).toContainEqual({
      key: 'el-1:p-0', textContent: 'New text',
    });
  });

  it('full sweep re-emits source-element image attributes (local-mode HMR resets)', () => {
    renderHook(() => useInstanceOverrideSync(doc, vi.fn()));
    doc.transact(() => {
      const srcAttrs = doc.getMap('sourceImageAttributes');
      const attrs = new Y.Map();
      srcAttrs.set('src/pages/index.astro:5:1', attrs);
      attrs.set('src', '/uploaded.png');
    }, 'user');
    postSpy.mockClear();

    window.dispatchEvent(new CustomEvent('sq:iframe-ready'));

    expect(messagesOfType('SYNC_IMAGE_ATTR_TO_IFRAME')).toContainEqual({
      key: 'src/pages/index.astro:5:1', attribute: 'src', value: '/uploaded.png',
    });
  });

  it('unmount removes the observer (no sync after teardown)', () => {
    const bump = vi.fn();
    const { unmount } = renderHook(() => useInstanceOverrideSync(doc, bump));
    unmount();
    addInstance('el-2');
    expect(bump).not.toHaveBeenCalled();
  });
});
