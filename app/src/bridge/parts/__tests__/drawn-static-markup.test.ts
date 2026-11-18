/**
 * INSERT_DRAWN_ELEMENT staticMarkup rendering (task-106 vector shapes).
 *
 * Pins the contract: non-slot drawn elements carrying staticMarkup render it
 * as innerHTML, and the update path (re-insert) does not clobber it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

describe('handleInsertDrawnElement staticMarkup', () => {
  let bridge: HarnessBridge;

  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest();
  });

  it('INSERT_DRAWN_ELEMENT with staticMarkup renders inner SVG', () => {
    bridge.handleInsertDrawnElement({
      key: 'drawn-svg-1',
      tag: 'div',
      classes: 'w-[100px] h-[50px]',
      textContent: '',
      parentKey: null,
      staticMarkup: '<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100"/></svg>',
    });
    const el = document.querySelector('[data-key="drawn-svg-1"]')!;
    expect(el.innerHTML).toContain('<svg');
  });

  it('re-insert (update path) does not clobber existing SVG innerHTML', () => {
    bridge.handleInsertDrawnElement({
      key: 'drawn-svg-1',
      tag: 'div',
      classes: 'w-[100px] h-[50px]',
      textContent: '',
      parentKey: null,
      staticMarkup: '<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100"/></svg>',
    });
    // second call hits the `existing` branch which sets className/textContent only;
    // shapes have empty textContent so innerHTML must survive
    bridge.handleInsertDrawnElement({
      key: 'drawn-svg-1',
      tag: 'div',
      classes: 'w-[120px] h-[50px]',
      textContent: '',
      parentKey: null,
    });
    const el = document.querySelector('[data-key="drawn-svg-1"]')!;
    expect(el.innerHTML).toContain('<svg');
    expect(el.className).toBe('w-[120px] h-[50px]');
  });

  it('re-insert WITH staticMarkup replaces innerHTML (pen node edits, task-107)', () => {
    bridge.handleInsertDrawnElement({
      key: 'pen-1',
      tag: 'div',
      classes: 'w-[100px]',
      textContent: '',
      parentKey: null,
      staticMarkup: '<svg viewBox="0 0 100 50"><path d="M 0 0 L 100 50"/></svg>',
    });
    bridge.handleInsertDrawnElement({
      key: 'pen-1',
      tag: 'div',
      classes: 'w-[80px]',
      textContent: '',
      parentKey: null,
      staticMarkup: '<svg viewBox="0 0 80 40"><path d="M 0 0 L 80 40"/></svg>',
    });
    const el = document.querySelector('[data-key="pen-1"]')!;
    expect(el.innerHTML).toContain('80 40');
    expect(el.className).toBe('w-[80px]');
  });
});
