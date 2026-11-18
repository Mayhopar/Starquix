/**
 * Regression: uploaded bg image dies on reload (blob-URL poisoning).
 * DOM className must ALWAYS keep the canonical sq-asset: form; blob URLs
 * are applied via inline style + #sq-asset-overrides stylesheet only.
 * Ledger: docs/plans/2026-07-02-bg-image-blob-poisoning-fix-ledger.md
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type AssetBridge = HarnessBridge & {
  _assetMap: Record<string, string>;
  _pendingAssetClasses: Record<string, unknown>;
  _pendingAssetImages: Record<string, unknown>;
  handleUpdateInstanceOverride: (p: { instanceId: string; selector: string; classes?: string }) => void;
  resolveAssetRefsInDOM: () => void;
};

function mount(): AssetBridge {
  const b = mountBridgeForTest() as AssetBridge;
  b._assetMap = {};
  b._pendingAssetClasses = {};
  b._pendingAssetImages = {};
  return b;
}

// Contains '/' + '.astro' → parseInstanceKey returns null → source-key path (dom-updates.ts:168)
const KEY = 'src/pages/index.astro:5:1';
const CANONICAL = "p-4 bg-[url('sq-asset:aaa111')]";

describe('bg-asset classes stay canonical in DOM className', () => {
  beforeEach(() => resetHarnessDom());

  it('handleUpdateClasses: className stays canonical, blob applied as inline style', () => {
    document.body.innerHTML = `<div data-key="${KEY}"></div>`;
    const b = mount();
    b._assetMap['aaa111'] = 'blob:sq-test/a';
    b.handleUpdateClasses({ key: KEY, classes: CANONICAL });
    const el = document.querySelector('div')!;
    expect(el.className).toBe(CANONICAL); // pre-fix: blob form → FAIL
    expect(el.style.backgroundImage).toContain('blob:sq-test/a');
  });

  it('handleUpdateClasses: asset not yet transferred → canonical className + queued pending', () => {
    document.body.innerHTML = `<div data-key="${KEY}"></div>`;
    const b = mount();
    b.handleUpdateClasses({ key: KEY, classes: CANONICAL });
    expect(document.querySelector('div')!.className).toBe(CANONICAL);
    expect(b._pendingAssetClasses[KEY]).toBeTruthy();
  });

  it('sibling data-sq-source elements get canonical className too', () => {
    document.body.innerHTML = `
      <div data-key="${KEY}" data-sq-source="index.astro:5:1"></div>
      <div data-sq-source="index.astro:5:1"></div>`;
    const b = mount();
    b._assetMap['aaa111'] = 'blob:sq-test/a';
    b.handleUpdateClasses({
      key: KEY, classes: CANONICAL,
      sourceLocation: { file: 'index.astro', line: 5, column: 1 },
    });
    document.querySelectorAll('[data-sq-source]').forEach((el) => {
      expect((el as HTMLElement).className).toBe(CANONICAL);
      expect((el as HTMLElement).style.backgroundImage).toContain('blob:sq-test/a');
    });
  });

  it('handleUpdateInstanceOverride: canonical className, blob inline style', () => {
    document.body.innerHTML = '<div data-key="el-abc:div-1"></div>';
    const b = mount();
    b._assetMap['aaa111'] = 'blob:sq-test/a';
    b.handleUpdateInstanceOverride({ instanceId: 'el-abc', selector: 'div-1', classes: CANONICAL });
    const el = document.querySelector('div')!;
    expect(el.className).toBe(CANONICAL); // pre-fix: blob form → FAIL
    expect(el.style.backgroundImage).toContain('blob:sq-test/a');
  });

  it('resolveAssetRefsInDOM: never rewrites className, only inline style', () => {
    const el = document.createElement('div');
    el.setAttribute('class', CANONICAL);
    document.body.appendChild(el);
    const b = mount();
    b._assetMap['aaa111'] = 'blob:sq-test/a';
    b.resolveAssetRefsInDOM();
    expect(el.className).toBe(CANONICAL); // pre-fix: blob form → FAIL
    expect(el.style.backgroundImage).toContain('blob:sq-test/a');
  });
});
