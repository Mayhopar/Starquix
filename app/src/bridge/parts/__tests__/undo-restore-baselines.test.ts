/**
 * task-149 / task-151 — the iframe is the ONLY place that ever saw the
 * pre-override value, so it is the only place that can hand it back.
 *
 * An undo that REMOVES an overlay entry means "put the element back the way the
 * source renders it". Neither snapshot carries that value: the doc holds
 * overrides, and the scan payload cannot supply it either — `classes` is read
 * live off the DOM (`scanning.ts`: `self.getElementClasses(element)`), so it
 * reports the OVERRIDE once any rescan happens after one was applied;
 * `textContent` is direct-text-nodes only, `.trim().slice(0, 200)`; and image
 * attributes are not in the payload at all.
 *
 * The bridge, though, holds the element in its pre-override state at the exact
 * instant it is asked to apply the first override. Capturing there is
 * first-wins, resets with the document on every reload (after which the DOM is
 * bare source again), and is the mechanism `originalTextByKey` /
 * RESTORE_ORIGINAL_TEXT has used for text edit sessions since task-018 — this
 * generalises it to classes and image attributes and to the observer-driven
 * (non-edit-session) text path.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type RestoreBridge = HarnessBridge & {
  _assetMap: Record<string, string>;
  _pendingAssetClasses: Record<string, unknown>;
  _pendingAssetImages: Record<string, unknown>;
  originalClassesByKey: Record<string, string>;
  originalImageAttrsByKey: Record<string, Record<string, string>>;
  handleUpdateImageAttribute: (p: { key: string; attribute: string; value: string }) => void;
  handleRestoreOriginalClasses: (p: { key: string; fallbackClasses?: string }) => void;
  handleRestoreOriginalImageAttributes: (p: { key: string; attributes?: string[] }) => void;
};

function mount(): RestoreBridge {
  const b = mountBridgeForTest() as RestoreBridge;
  b._assetMap = {};
  b._pendingAssetClasses = {};
  b._pendingAssetImages = {};
  return b;
}

const KEY = 'src/components/Feature.astro:20:5~p4317f4b4863ead18';

describe('classes — capture on first override, restore on undo', () => {
  beforeEach(() => resetHarnessDom());

  it('restores the class attribute the element had BEFORE the first override', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}" class="text-2xl font-bold"></h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    bridge.handleUpdateClasses({ key: KEY, classes: 'text-2xl text-red-500' });
    expect(el.getAttribute('class')).toBe('text-2xl text-red-500');

    bridge.handleRestoreOriginalClasses({ key: KEY });

    expect(el.getAttribute('class')).toBe('text-2xl font-bold');
  });

  it('the baseline is FIRST-WINS — a second override never overwrites it', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}" class="text-2xl font-bold"></h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    bridge.handleUpdateClasses({ key: KEY, classes: 'text-red-500' });
    bridge.handleUpdateClasses({ key: KEY, classes: 'text-violet-500' });

    bridge.handleRestoreOriginalClasses({ key: KEY });

    expect(el.getAttribute('class')).toBe('text-2xl font-bold');
  });

  it('the restore itself must not become the new baseline (⌘Z ⇧⌘Z ⌘Z stays correct)', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}" class="text-2xl font-bold"></h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    bridge.handleUpdateClasses({ key: KEY, classes: 'text-red-500' });
    bridge.handleRestoreOriginalClasses({ key: KEY });   // ⌘Z
    bridge.handleUpdateClasses({ key: KEY, classes: 'text-red-500' });   // ⇧⌘Z
    bridge.handleRestoreOriginalClasses({ key: KEY });   // ⌘Z again

    expect(el.getAttribute('class')).toBe('text-2xl font-bold');
  });

  it('falls back to the parent-supplied classes when the bridge never captured one', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}" class="text-red-500"></h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    bridge.handleRestoreOriginalClasses({ key: KEY, fallbackClasses: 'text-2xl font-bold' });

    expect(el.getAttribute('class')).toBe('text-2xl font-bold');
  });

  it('no capture and no fallback → the DOM is left alone (never blanked)', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}" class="text-red-500"></h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    bridge.handleRestoreOriginalClasses({ key: KEY });

    expect(el.getAttribute('class')).toBe('text-red-500');
  });

  it('an element that is genuinely class-less restores to empty, not to the override', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}"></h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    bridge.handleUpdateClasses({ key: KEY, classes: 'text-red-500' });
    bridge.handleRestoreOriginalClasses({ key: KEY });

    expect(el.getAttribute('class') ?? '').toBe('');
  });
});

describe('text — the observer-driven path captures a baseline too', () => {
  beforeEach(() => resetHarnessDom());

  it('UPDATE_TEXT captures the pre-override text, RESTORE_ORIGINAL_TEXT gives it back', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}">Master headline</h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    // No ENTER_EDIT_MODE: this is the AI / undo / scan-re-apply path.
    bridge.handleUpdateText({ key: KEY, textContent: 'Hand-written headline' });
    expect(el.textContent).toBe('Hand-written headline');

    bridge.handleRestoreOriginalText({ key: KEY });

    expect(el.textContent).toBe('Master headline');
  });

  it('an ENTER_EDIT_MODE baseline is authoritative and is not overwritten by UPDATE_TEXT', () => {
    const bridge = mount();
    document.body.innerHTML = `<h2 data-sq-source="${KEY}">Already overridden</h2>`;
    const el = document.querySelector('h2') as HTMLElement;

    bridge.handleEnterEditMode({ key: KEY, originalText: 'Real source text' });
    bridge.handleUpdateText({ key: KEY, textContent: 'Newer override' });

    bridge.handleRestoreOriginalText({ key: KEY });

    expect(el.textContent).toBe('Real source text');
  });
});

describe('image attributes — capture on first override, restore on undo', () => {
  beforeEach(() => resetHarnessDom());

  it('restores every attribute the override touched', () => {
    const bridge = mount();
    document.body.innerHTML =
      '<img data-key="el-x:img-0" src="/master.png" alt="master alt" />';
    const img = document.querySelector('img') as HTMLImageElement;

    bridge.handleUpdateImageAttribute({ key: 'el-x:img-0', attribute: 'src', value: '/mine.png' });
    bridge.handleUpdateImageAttribute({ key: 'el-x:img-0', attribute: 'alt', value: 'my alt' });

    bridge.handleRestoreOriginalImageAttributes({ key: 'el-x:img-0' });

    expect(img.getAttribute('src')).toBe('/master.png');
    expect(img.getAttribute('alt')).toBe('master alt');
  });

  it('an attribute the source did not have is REMOVED again, not set to ""', () => {
    const bridge = mount();
    document.body.innerHTML = '<img data-key="el-x:img-0" src="/master.png" />';
    const img = document.querySelector('img') as HTMLImageElement;

    bridge.handleUpdateImageAttribute({ key: 'el-x:img-0', attribute: 'alt', value: 'my alt' });
    bridge.handleRestoreOriginalImageAttributes({ key: 'el-x:img-0' });

    expect(img.hasAttribute('alt')).toBe(false);
  });

  it('first-wins per attribute across repeated overrides', () => {
    const bridge = mount();
    document.body.innerHTML = '<img data-key="el-x:img-0" src="/master.png" />';
    const img = document.querySelector('img') as HTMLImageElement;

    bridge.handleUpdateImageAttribute({ key: 'el-x:img-0', attribute: 'src', value: '/a.png' });
    bridge.handleUpdateImageAttribute({ key: 'el-x:img-0', attribute: 'src', value: '/b.png' });

    bridge.handleRestoreOriginalImageAttributes({ key: 'el-x:img-0' });

    expect(img.getAttribute('src')).toBe('/master.png');
  });

  it('no capture → the DOM is left alone', () => {
    const bridge = mount();
    document.body.innerHTML = '<img data-key="el-x:img-0" src="/mine.png" />';
    const img = document.querySelector('img') as HTMLImageElement;

    bridge.handleRestoreOriginalImageAttributes({ key: 'el-x:img-0' });

    expect(img.getAttribute('src')).toBe('/mine.png');
  });
});
