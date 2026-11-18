import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type VerifyBridge = HarnessBridge & {
  handleVerifyLayout: (p: { requestId: string; keys: string[] }) => void;
};

function rect(el: Element, r: Partial<DOMRect>) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...r }) as DOMRect;
}

describe('handleVerifyLayout', () => {
  let bridge: VerifyBridge;
  beforeEach(() => {
    resetHarnessDom();
    bridge = mountBridgeForTest() as VerifyBridge;
    bridge.sendToParent = vi.fn();
  });

  function findings() {
    const call = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as
      { type: string; payload: { requestId: string; findings: Array<{ key: string; severity: string; issue: string }> } };
    expect(call.type).toBe('LAYOUT_VERIFIED');
    return call.payload;
  }

  it('reports sibling overlap between static siblings', () => {
    document.body.innerHTML = `
      <div><div data-key="a">A</div><div data-key="b">B</div></div>`;
    const a = document.querySelector('[data-key="a"]')!;
    const b = document.querySelector('[data-key="b"]')!;
    rect(a, { top: 0, left: 0, right: 100, bottom: 50, width: 100, height: 50 });
    rect(b, { top: 20, left: 0, right: 100, bottom: 70, width: 100, height: 50 });
    bridge.handleVerifyLayout({ requestId: 'r1', keys: ['a'] });
    const { requestId, findings: f } = findings();
    expect(requestId).toBe('r1');
    expect(f.some(x => x.issue.includes('overlaps'))).toBe(true);
  });

  it('reports overflow beyond parent', () => {
    document.body.innerHTML = `<div data-key="p"><div data-key="c">C</div></div>`;
    rect(document.querySelector('[data-key="p"]')!, { top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100 });
    rect(document.querySelector('[data-key="c"]')!, { top: 0, left: 0, right: 260, bottom: 100, width: 260, height: 100 });
    bridge.handleVerifyLayout({ requestId: 'r2', keys: ['c'] });
    expect(findings().findings.some(x => x.issue.includes('overflows'))).toBe(true);
  });

  it('reports zero-size element with content', () => {
    document.body.innerHTML = `<div data-key="z">text</div>`;
    rect(document.querySelector('[data-key="z"]')!, { width: 0, height: 0 });
    bridge.handleVerifyLayout({ requestId: 'r3', keys: ['z'] });
    expect(findings().findings.some(x => x.issue.includes('zero-size'))).toBe(true);
  });

  it('reports low text contrast (inline styles)', () => {
    document.body.innerHTML = `<p data-key="t" style="color: rgb(200,200,200); background-color: rgb(255,255,255)">hi</p>`;
    rect(document.querySelector('[data-key="t"]')!, { top: 0, left: 0, right: 50, bottom: 20, width: 50, height: 20 });
    bridge.handleVerifyLayout({ requestId: 'r4', keys: ['t'] });
    expect(findings().findings.some(x => x.issue.includes('contrast'))).toBe(true);
  });

  it('returns empty findings for a clean element and unknown keys report not-found', () => {
    document.body.innerHTML = `<p data-key="ok" style="color: rgb(0,0,0); background-color: rgb(255,255,255)">hi</p>`;
    rect(document.querySelector('[data-key="ok"]')!, { top: 0, left: 0, right: 50, bottom: 20, width: 50, height: 20 });
    bridge.handleVerifyLayout({ requestId: 'r5', keys: ['ok', 'ghost'] });
    const f = findings().findings;
    expect(f.filter(x => x.key === 'ok')).toHaveLength(0);
    expect(f.some(x => x.key === 'ghost' && x.issue.includes('not found'))).toBe(true);
  });
});
