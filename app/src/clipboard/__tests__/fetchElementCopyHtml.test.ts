import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchElementCopyHtml } from '../fetchElementCopyHtml';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('fetchElementCopyHtml', () => {
  it('resolves with html when the result event carries the matching requestId', async () => {
    const sent: Array<{ key: string; requestId: string }> = [];
    window.addEventListener('sq:copy-element-html', ((e: CustomEvent) => {
      sent.push(e.detail);
      window.dispatchEvent(new CustomEvent('sq:copy-element-html-result', {
        detail: { requestId: e.detail.requestId, key: e.detail.key, html: '<div>x</div>' },
      }));
    }) as EventListener, { once: true });

    await expect(fetchElementCopyHtml('k1')).resolves.toBe('<div>x</div>');
    expect(sent[0].key).toBe('k1');
  });

  it('resolves null on timeout', async () => {
    const p = fetchElementCopyHtml('k2');
    vi.advanceTimersByTime(3100);
    await expect(p).resolves.toBeNull();
  });

  it('ignores results for other requestIds', async () => {
    const p = fetchElementCopyHtml('k3');
    window.dispatchEvent(new CustomEvent('sq:copy-element-html-result', {
      detail: { requestId: 'other', key: 'k3', html: '<div>wrong</div>' },
    }));
    vi.advanceTimersByTime(3100);
    await expect(p).resolves.toBeNull();
  });
});
