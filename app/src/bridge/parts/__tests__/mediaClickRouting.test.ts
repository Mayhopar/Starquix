/**
 * task-206 D4: ANY click that lands inside a rendered <Media/> (.sq-media)
 * selects the MEDIA UNIT — the .sq-media root — never the outermost post
 * root the selection walk would otherwise return. ⌘-click (directSelect)
 * keeps the innermost element for power users.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

describe('findEditableElement media-unit routing', () => {
  beforeEach(() => resetHarnessDom());

  function mount() {
    document.body.innerHTML =
      '<article data-key="post-root">' +
      '<p data-key="p-1">text</p>' +
      '<div data-sq-block="component" data-sq-body-line="6" data-sq-body-end="6">' +
      '<div class="sq-media" data-sq-unit="media" data-key="media-root">' +
      '<img data-key="media-img" data-sq-media-slot="0">' +
      '</div></div></article>';
    return mountBridgeForTest() as unknown as {
      findEditableElement: (t: Element | null, s?: boolean, d?: boolean) => Element | null;
    };
  }

  it('single click on the img selects the .sq-media root', () => {
    const bridge = mount();
    const img = document.querySelector('[data-key="media-img"]')!;
    const result = bridge.findEditableElement(img, true, false);
    expect(result?.getAttribute('data-key')).toBe('media-root');
  });

  it('⌘-click (directSelect) still reaches the innermost element', () => {
    const bridge = mount();
    const img = document.querySelector('[data-key="media-img"]')!;
    const result = bridge.findEditableElement(img, true, true);
    expect(result?.getAttribute('data-key')).toBe('media-img');
  });

  it('clicks outside .sq-media keep the outermost-ancestor walk', () => {
    const bridge = mount();
    const p = document.querySelector('[data-key="p-1"]')!;
    const result = bridge.findEditableElement(p, true, false);
    expect(result?.getAttribute('data-key')).toBe('post-root');
  });
});
