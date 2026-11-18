/**
 * Smoke + handler tests for BRIDGE_DOM_UPDATES.
 *
 * Covers:
 * - Harness mounts and exposes prototype methods (smoke)
 * - handleWriteClasses delegates to window.__SQ_WRITE_CLASSES__
 * - handleReorderElements actually reorders DOM
 *
 * If a bridge handler regression slips past the existing snapshot-parity
 * guard, these tests are the next line of defense.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

describe('bridge dom-updates harness', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
  });

  it('exposes BRIDGE_UTILS prototype methods (sanity check that utils were evaluated)', () => {
    expect(typeof bridge.findElementByKey).toBe('function');
    expect(typeof bridge.getElementKey).toBe('function');
  });
});

// Chromium fixed-layer raster bug workaround (2026-08-23): regions of a
// position:fixed element outside the canvas clip at the iframe's first raster
// are never re-rastered when a pan reveals them. handleRepaintFixed toggles
// will-change:transform to force a fresh composited layer (fresh raster),
// then restores — the repaint survives the restore.
describe('handleRepaintFixed', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('toggles will-change on fixed elements and restores it after the hold window', () => {
    const fixed = document.createElement('header');
    fixed.style.position = 'fixed';
    const staticEl = document.createElement('div');
    document.body.append(fixed, staticEl);

    bridge.handleRepaintFixed();

    expect(fixed.style.willChange).toBe('transform');
    expect(staticEl.style.willChange).toBe('');

    vi.runAllTimers();

    expect(fixed.style.willChange).toBe('');
    expect(staticEl.style.willChange).toBe('');
  });

  it('never clobbers a pre-existing inline will-change', () => {
    const fixed = document.createElement('div');
    fixed.style.position = 'fixed';
    fixed.style.willChange = 'opacity';
    document.body.append(fixed);

    bridge.handleRepaintFixed();
    vi.runAllTimers();

    expect(fixed.style.willChange).toBe('opacity');
  });

  it('is a no-op while a toggle is already in flight (no double-restore clobber)', () => {
    const fixed = document.createElement('div');
    fixed.style.position = 'fixed';
    document.body.append(fixed);

    bridge.handleRepaintFixed();
    bridge.handleRepaintFixed(); // in-flight: must not re-save 'transform' as the restore value

    vi.runAllTimers();
    expect(fixed.style.willChange).toBe('');
  });

  it('is registered for the REPAINT_FIXED parent message', () => {
    bridge._handlers = {};
    bridge.registerHandlers();
    const spy = vi.spyOn(bridge, 'handleRepaintFixed');
    bridge._handlers['REPAINT_FIXED']({});
    expect(spy).toHaveBeenCalled();
  });
});

describe('handleWriteClasses', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
    delete (window as unknown as { __SQ_WRITE_CLASSES__?: unknown }).__SQ_WRITE_CLASSES__;
  });

  afterEach(() => {
    delete (window as unknown as { __SQ_WRITE_CLASSES__?: unknown }).__SQ_WRITE_CLASSES__;
  });

  it('delegates to window.__SQ_WRITE_CLASSES__ when present', () => {
    const writer = vi.fn();
    (window as unknown as { __SQ_WRITE_CLASSES__: typeof writer }).__SQ_WRITE_CLASSES__ = writer;

    const payload = {
      sourceLocation: { file: 'src/Foo.astro', line: 1, column: 1 },
      requestId: 'req-1',
      classes: 'flex gap-2',
    };
    bridge.handleWriteClasses(payload);

    expect(writer).toHaveBeenCalledWith(payload);
  });

  it('rejects payloads missing sourceLocation or requestId', () => {
    const writer = vi.fn();
    (window as unknown as { __SQ_WRITE_CLASSES__: typeof writer }).__SQ_WRITE_CLASSES__ = writer;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    bridge.handleWriteClasses({});
    bridge.handleWriteClasses({ sourceLocation: { file: 'a', line: 1, column: 1 } });

    expect(writer).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('handleReorderElements', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
  });

  it('reorders sibling elements to match payload.elementIds', () => {
    document.body.innerHTML = `
      <div id="root">
        <div data-key="el-a">A</div>
        <div data-key="el-b">B</div>
        <div data-key="el-c">C</div>
      </div>
    `;

    bridge.handleReorderElements({ elementIds: ['el-c', 'el-a', 'el-b'] });

    const order = Array.from(document.querySelectorAll('#root [data-key]')).map((el) =>
      el.getAttribute('data-key'),
    );
    expect(order).toEqual(['el-c', 'el-a', 'el-b']);
  });

  it('is a no-op when fewer than 2 keys resolve to elements', () => {
    document.body.innerHTML = `
      <div id="root">
        <div data-key="el-a">A</div>
      </div>
    `;
    expect(() =>
      bridge.handleReorderElements({ elementIds: ['el-a', 'missing'] }),
    ).not.toThrow();
    expect(document.querySelector('[data-key="el-a"]')).not.toBeNull();
  });

  it('refuses to reorder elements that do not share a parent', () => {
    document.body.innerHTML = `
      <div id="root-a"><div data-key="el-a">A</div></div>
      <div id="root-b"><div data-key="el-b">B</div></div>
    `;

    bridge.handleReorderElements({ elementIds: ['el-b', 'el-a'] });

    // a stays under root-a, b stays under root-b
    expect(document.querySelector('#root-a [data-key="el-a"]')).not.toBeNull();
    expect(document.querySelector('#root-b [data-key="el-b"]')).not.toBeNull();
    expect(document.querySelector('#root-a [data-key="el-b"]')).toBeNull();
  });
});

describe('handleSetThemeMode', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-mode');
  });

  it('sets data-mode on <html> for a named mode', () => {
    bridge.handleSetThemeMode({ mode: 'dark' });
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });

  it('removes data-mode for null/undefined mode (default mode)', () => {
    document.documentElement.setAttribute('data-mode', 'dark');
    bridge.handleSetThemeMode({ mode: null });
    expect(document.documentElement.hasAttribute('data-mode')).toBe(false);
  });

  it('tolerates a missing payload', () => {
    expect(() => bridge.handleSetThemeMode(undefined)).not.toThrow();
    expect(document.documentElement.hasAttribute('data-mode')).toBe(false);
  });
});
