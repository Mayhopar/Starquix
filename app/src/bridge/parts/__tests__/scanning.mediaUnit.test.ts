/**
 * task-206: any scanned element inside a rendered <Media/> (.sq-media root)
 * reports the enclosing MEDIA UNIT — the rehype wrapper's data-sq-body-line/end
 * stamps — so the DesignBar can splice the invocation in the post .mdx.
 * Elements outside any .sq-media carry no mediaUnit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = {
  key: string;
  mediaUnit?: { bodyLine: number; bodyEnd: number };
};

function runScan(bridge: HarnessBridge): ScannedEl[] {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

describe('scan reports the enclosing Media unit', () => {
  beforeEach(() => resetHarnessDom());

  it('img inside .sq-media carries the wrapper body-line stamps', () => {
    document.body.innerHTML =
      '<div data-sq-block="component" data-sq-body-line="12" data-sq-body-end="12">' +
      '<div class="sq-media" data-sq-unit="media" data-key="el-1:div-0">' +
      '<img data-key="el-1:img-0" data-sq-media-slot="0" data-sq-source="src/components/sq/Media.astro:40:9">' +
      '</div></div>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const img = elements.find((e) => e.key === 'el-1:img-0');
    expect(img, 'img must be in the scan').toBeTruthy();
    expect(img!.mediaUnit).toEqual({ bodyLine: 12, bodyEnd: 12 });

    const root = elements.find((e) => e.key === 'el-1:div-0');
    expect(root!.mediaUnit).toEqual({ bodyLine: 12, bodyEnd: 12 });
  });

  it('element outside any .sq-media has no mediaUnit', () => {
    document.body.innerHTML = '<section data-key="el-2:section-0">plain</section>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    const el = elements.find((e) => e.key === 'el-2:section-0');
    expect(el!.mediaUnit).toBeUndefined();
  });
});

/**
 * task-207 Task 9. The D8 probe (see the ledger) showed the rehype pass wraps
 * EVERY component invocation in the post body, including ones that do not
 * spread `...rest` and therefore declare no `data-sq-unit` of their own. A
 * promoted `sq/` component must report the same stamps Media does — otherwise
 * it would be permanently read-only the day it is promoted.
 */
describe('scan reports the enclosing unit for any sq/ component (task-207)', () => {
  beforeEach(() => resetHarnessDom());

  it('a promoted component with NO data-sq-unit still reports the stamps', () => {
    document.body.innerHTML =
      '<div data-sq-block="component" data-sq-body-line="25" data-sq-body-end="28">' +
      '<section data-key="el-9:section-0" data-sq-source="src/components/sq/Credit.astro:4:1">' +
      '<h4 data-key="el-9:h4-0" data-sq-source="src/components/sq/Credit.astro:5:3">Role</h4>' +
      '</section></div>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.key === 'el-9:section-0')!.mediaUnit)
      .toEqual({ bodyLine: 25, bodyEnd: 28 });
    expect(elements.find((e) => e.key === 'el-9:h4-0')!.mediaUnit)
      .toEqual({ bodyLine: 25, bodyEnd: 28 });
  });

  it('a NON-sq component in the same post reports no unit — it is the user’s own markup', () => {
    document.body.innerHTML =
      '<div data-sq-block="component" data-sq-body-line="11" data-sq-body-end="11">' +
      '<figure data-key="el-8:figure-0" data-sq-source="src/components/SingleImage.astro:5:1"></figure>' +
      '</div>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.key === 'el-8:figure-0')!.mediaUnit).toBeUndefined();
  });

  it('Media still resolves even though its own root inherits data-sq-block via ...rest', () => {
    // The probe found the spread duplicates data-sq-block onto Media's root, so
    // `closest` matches the root itself. Same stamps either way — pinned so a
    // future de-duplication of that attribute cannot silently break the walk.
    document.body.innerHTML =
      '<div data-sq-block="component" data-sq-body-line="19" data-sq-body-end="19">' +
      '<div class="sq-media" data-sq-unit="media" data-sq-block="component"' +
      ' data-sq-body-line="19" data-sq-body-end="19" data-key="el-7:div-0"' +
      ' data-sq-source="src/components/sq/Media.astro:75:1">' +
      '<img data-key="el-7:img-0" data-sq-source="src/components/sq/Media.astro:40:9">' +
      '</div></div>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.key === 'el-7:img-0')!.mediaUnit)
      .toEqual({ bodyLine: 19, bodyEnd: 19 });
  });
});

/**
 * task-207, found by verifying on the real post route: a promoted component
 * can be used INSIDE another component rather than directly in the post body.
 * The enclosing [data-sq-block="component"] is then the OUTER component's
 * block, so splicing it would rewrite the wrong invocation — `setProp` would
 * match the first matching attribute anywhere in that block, i.e. an arbitrary
 * nested tag. We refuse: no stamp, no panel, nothing written.
 */
describe('a sq/ component NESTED in another component is not a write target', () => {
  beforeEach(() => resetHarnessDom());

  it('reports no unit when the block root is a different component', () => {
    document.body.innerHTML =
      '<div data-sq-block="component" data-sq-body-line="25" data-sq-body-end="28">' +
      '<section data-key="el-6:section-0" data-sq-source="src/components/CreditWrapper.astro:4:1">' +
      '<li data-key="el-6:li-0" data-sq-source="src/components/sq/Credit.astro:4:1">' +
      '<span data-key="el-6:span-0" data-sq-source="src/components/sq/Credit.astro:4:20"></span>' +
      '</li></section></div>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.key === 'el-6:li-0')!.mediaUnit).toBeUndefined();
    expect(elements.find((e) => e.key === 'el-6:span-0')!.mediaUnit).toBeUndefined();
  });

  it('the SAME component placed directly in the post body IS a write target', () => {
    document.body.innerHTML =
      '<div data-sq-block="component" data-sq-body-line="30" data-sq-body-end="30">' +
      '<li data-key="el-5:li-0" data-sq-source="src/components/sq/Credit.astro:4:1">' +
      '<span data-key="el-5:span-0" data-sq-source="src/components/sq/Credit.astro:4:20"></span>' +
      '</li></div>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.key === 'el-5:li-0')!.mediaUnit)
      .toEqual({ bodyLine: 30, bodyEnd: 30 });
    expect(elements.find((e) => e.key === 'el-5:span-0')!.mediaUnit)
      .toEqual({ bodyLine: 30, bodyEnd: 30 });
  });
});

/** Post body text reports its block's body line — where the writing view opens on double-click. */
describe('scan reports the enclosing post body line', () => {
  beforeEach(() => resetHarnessDom());

  it('a body paragraph and its inline child carry the block stamp; page chrome carries none', () => {
    document.body.innerHTML =
      '<main data-key="el-1:main-0"><p data-sq-body-line="3" data-sq-body-end="3" data-key="src/content/posts/a.mdx:9:1">' +
      'Hi <strong data-key="src/content/posts/a.mdx:9:4">there</strong></p></main>';

    const elements = runScan(mountBridgeForTest()) as Array<ScannedEl & { bodyLine?: number }>;
    expect(elements.find((e) => e.key === 'src/content/posts/a.mdx:9:1')!.bodyLine).toBe(3);
    expect(elements.find((e) => e.key === 'src/content/posts/a.mdx:9:4')!.bodyLine).toBe(3);
    expect(elements.find((e) => e.key === 'el-1:main-0')!.bodyLine).toBeUndefined();
  });
});
