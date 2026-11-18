// THE local-mode write-scope law: from a page view a write may only target the
// page file; the component view makes the component file the surface, so master
// edits there proceed. Data-loss incident 2026-08-02 (Header.astro / Back.astro).
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  captureLocalWriteOrigin,
  isCrossFileAtOrigin,
  classifyLocalWriteTarget,
  isLocalCrossFileWrite,
  localFileLabel,
  localCrossFileRefusal,
  notifyLocalCrossFileWrite,
  LOCAL_CROSS_FILE_WRITE_EVENT,
  allowsCrossFileOverrideWrite,
} from '../localWriteScope';
import {
  setLocalExpectedRoute,
  setLocalPageFile,
  _resetLocalPageSyncForTests,
} from '../localPageSync';

const PAGE = 'src/pages/index.astro';
const COMPONENT = 'src/components/Header.astro';

beforeEach(() => _resetLocalPageSyncForTests());

describe('classifyLocalWriteTarget', () => {
  it('same file as the surface → same-file', () => {
    setLocalPageFile(PAGE);
    expect(classifyLocalWriteTarget(PAGE)).toBe('same-file');
  });

  it('a component rendered by the page → cross-file', () => {
    setLocalPageFile(PAGE);
    expect(classifyLocalWriteTarget(COMPONENT)).toBe('cross-file');
  });

  it('unknown surface file default-denies (never assume same-file)', () => {
    setLocalPageFile(null);
    expect(classifyLocalWriteTarget(PAGE)).toBe('cross-file');
  });

  it('missing/empty target file default-denies', () => {
    setLocalPageFile(PAGE);
    expect(classifyLocalWriteTarget(null)).toBe('cross-file');
    expect(classifyLocalWriteTarget(undefined)).toBe('cross-file');
    expect(classifyLocalWriteTarget('')).toBe('cross-file');
  });

  it('an explicit pageFile overrides the armed surface', () => {
    setLocalPageFile(PAGE);
    expect(classifyLocalWriteTarget(COMPONENT, COMPONENT)).toBe('same-file');
    expect(classifyLocalWriteTarget(PAGE, COMPONENT)).toBe('cross-file');
  });

  it('COMPONENT VIEW: the component file IS the surface → its own edits are same-file', () => {
    setLocalPageFile(COMPONENT); // Editor: resolveLocalPageFile(componentViewFile)
    expect(classifyLocalWriteTarget(COMPONENT)).toBe('same-file');
    expect(classifyLocalWriteTarget(PAGE)).toBe('cross-file');
  });
});

describe('isLocalCrossFileWrite (armed form)', () => {
  it('DISARMED off the local runtime — WC/server/legacy writes are untouched', () => {
    setLocalExpectedRoute(null);
    setLocalPageFile(null);
    expect(isLocalCrossFileWrite(COMPONENT)).toBe(false);
    expect(isLocalCrossFileWrite('src/anything/else.astro')).toBe(false);
  });

  it('armed in local mode: page surface refuses a component target', () => {
    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
    expect(isLocalCrossFileWrite(COMPONENT)).toBe(true);
    expect(isLocalCrossFileWrite(PAGE)).toBe(false);
  });

  it('armed in local mode with an unknown surface file: default-deny', () => {
    setLocalExpectedRoute('/');
    setLocalPageFile(null);
    expect(isLocalCrossFileWrite(PAGE)).toBe(true);
  });

  it('armed in the component view: the component file writes, the page file does not', () => {
    setLocalExpectedRoute(`/__sq_component_view/${COMPONENT}`);
    setLocalPageFile(COMPONENT);
    expect(isLocalCrossFileWrite(COMPONENT)).toBe(false);
    expect(isLocalCrossFileWrite(PAGE)).toBe(true);
  });
});

describe('refusal copy + notification', () => {
  it('names the component file and the way out', () => {
    expect(localFileLabel(COMPONENT)).toBe('Header.astro');
    expect(localCrossFileRefusal(COMPONENT)).toContain('Header.astro');
    expect(localCrossFileRefusal(COMPONENT)).toMatch(/open it/i);
  });

  it('notify dispatches the event carrying the file', () => {
    const seen: string[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent).detail.file);
    window.addEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, h);
    notifyLocalCrossFileWrite(COMPONENT);
    window.removeEventListener(LOCAL_CROSS_FILE_WRITE_EVENT, h);
    expect(seen).toEqual([COMPONENT]);
  });

  it('notify is inert without a window (node/SSR)', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    notifyLocalCrossFileWrite(COMPONENT);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * task-181 — a DEFERRED write carries the scope decision of the surface it was
 * MADE on. The class queue flushes up to 5 s after the gesture, and the law is
 * evaluated at flush time, so without this an instance edit made on a page is
 * re-judged against the master view and written into the component file.
 */
describe('captureLocalWriteOrigin / isCrossFileAtOrigin', () => {
  const enterComponentView = () => {
    setLocalExpectedRoute(`/__sq_component_view/${COMPONENT}`);
    setLocalPageFile(COMPONENT);
  };

  it('an instance gesture stays cross-file after the surface becomes the component', () => {
    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
    const origin = captureLocalWriteOrigin();

    enterComponentView();
    // The live guard now says same-file — that is the bug this closes.
    expect(isLocalCrossFileWrite(COMPONENT)).toBe(false);
    expect(isCrossFileAtOrigin(origin, COMPONENT)).toBe(true);
  });

  it('a master gesture made IN the component view stays same-file', () => {
    enterComponentView();
    const origin = captureLocalWriteOrigin();

    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
    expect(isCrossFileAtOrigin(origin, COMPONENT)).toBe(false);
  });

  it('captures `armed` too — Editor nulls expectedRoute on unmount', () => {
    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
    const origin = captureLocalWriteOrigin();

    setLocalExpectedRoute(null);
    setLocalPageFile(null);
    // The choke point is disarmed from here on; only the captured origin refuses.
    expect(isLocalCrossFileWrite(COMPONENT)).toBe(false);
    expect(isCrossFileAtOrigin(origin, COMPONENT)).toBe(true);
  });

  it('is inert off the local runtime (nothing ever armed the gate)', () => {
    const origin = captureLocalWriteOrigin();
    expect(origin).toEqual({ armed: false, pageFile: null });
    expect(isCrossFileAtOrigin(origin, COMPONENT)).toBe(false);
  });

  it('a missing origin is inert — immediate write paths are unchanged', () => {
    setLocalExpectedRoute('/');
    setLocalPageFile(PAGE);
    expect(isCrossFileAtOrigin(undefined, COMPONENT)).toBe(false);
  });
});

// 2026-08-27: the master-surface relaxation lets an override-tier write cross
// into a nested component's OWN file — never into a page file. Caught by
// BaseViteWriter.crossFileScope "PAGE-file write from the component view is
// refused" hanging on the dispatched postMessage.
describe('allowsCrossFileOverrideWrite: both ends must be masters', () => {
  const LAYOUT = 'src/layouts/Layout.astro';
  const masterOrigin = { armed: true, pageFile: COMPONENT };
  it('master surface → another master file: allowed', () => {
    expect(allowsCrossFileOverrideWrite(masterOrigin, LAYOUT)).toBe(true);
  });
  it('master surface → a PAGE file: refused', () => {
    expect(allowsCrossFileOverrideWrite(masterOrigin, PAGE)).toBe(false);
  });
  it('page surface → anything: refused', () => {
    expect(allowsCrossFileOverrideWrite({ armed: true, pageFile: PAGE }, COMPONENT)).toBe(false);
  });
  it('no origin: judged on the current surface, same target rule', () => {
    setLocalExpectedRoute(`/__sq_component_view/${COMPONENT}`);
    setLocalPageFile(COMPONENT);
    expect(allowsCrossFileOverrideWrite(undefined, PAGE)).toBe(false);
    expect(allowsCrossFileOverrideWrite(undefined, LAYOUT)).toBe(true);
  });
});
