import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

afterEach(() => { delete (window as any).__SQ_LOCAL_MODE__; resetHarnessDom(); });

describe('source version transport', () => {
  it('scans on a matching href without any token and publishes the document id and both source versions', () => {
    (window as any).__SQ_LOCAL_MODE__ = true;
    document.body.innerHTML = '<div id="sq-components"><p data-sq-source="src/components/Card.astro:2:3" data-sq-source-version="s123:55" data-sq-usage="src/pages/index.astro:7:2" data-sq-usage-version="s456:99">Card</p></div>';
    const bridge = mountBridgeForTest() as any;
    bridge._assetMap = {};
    bridge.reportContentHeight = vi.fn();
    delete bridge.scanElements;
    bridge.handleRequestLocalRoute({ requestId: 'route-1' });
    const { documentId } = bridge.sendToParent.mock.calls.find(([m]: any[]) => m.type === 'LOCAL_ROUTE_RESULT')[0].payload;
    bridge.sendToParent.mockClear();
    bridge.handleRequestLocalScan({ href: new URL('/elsewhere', window.location.href).href });
    expect(bridge.sendToParent.mock.calls.some(([m]: any[]) => m.type === 'ELEMENTS_SCANNED')).toBe(false);
    bridge.handleRequestLocalScan({ href: window.location.href });
    const scan = bridge.sendToParent.mock.calls.find(([m]: any[]) => m.type === 'ELEMENTS_SCANNED')[0].payload;
    expect(scan).toMatchObject({ documentId });
    expect(scan.sourceScanToken).toBeUndefined();
    expect(scan.elements.find((el: any) => el.tagName === 'p')).toMatchObject({
      sourceLocation: { sourceVersion: 's123:55' }, usageLocation: { sourceVersion: 's456:99' },
    });
  });
  it('keeps defining and placing versions distinct, including forwarded placement props', () => {
    (window as any).__SQ_LOCAL_MODE__ = true;
    const bridge = mountBridgeForTest() as any;
    const node = document.createElement('div');
    node.setAttribute('data-sq-source', 'src/components/Card.astro:2:3');
    node.setAttribute('data-sq-source-version', 's123:55');
    node.setAttribute('data-sq-p', 's1 q1 p1 src/pages/my page.astro:7:2\ts456:99');
    expect(bridge.parseSourceLocation(node)).toEqual({ file: 'src/components/Card.astro', line: 2, column: 3, sourceVersion: 's123:55' });
    expect(bridge.parseUsageLocation(node)).toEqual({ file: 'src/pages/my page.astro', line: 7, column: 2, sourceVersion: 's456:99' });
    node.setAttribute('data-sq-usage', '');
    node.setAttribute('data-sq-usage-version', '');
    expect(bridge.parseUsageLocation(node)).toBeUndefined();
  });
});
