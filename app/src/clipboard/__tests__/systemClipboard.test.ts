import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeClipboardHtml, readClipboardHtml } from '../systemClipboard';

const stubClipboard = (impl: Partial<{ write: (i: unknown[]) => Promise<void>; read: () => Promise<unknown[]> }>) => {
  Object.defineProperty(navigator, 'clipboard', { value: impl, configurable: true });
};

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  vi.unstubAllGlobals();
});

describe('systemClipboard', () => {
  it('writes html + plain text via ClipboardItem', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write });
    vi.stubGlobal('ClipboardItem', class {
      items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) { this.items = items; }
    });
    await expect(writeClipboardHtml('<span data-sq-clipboard="AA">x</span>', 'Starquix: x')).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('returns false when clipboard write is unavailable/refused', async () => {
    stubClipboard({ write: vi.fn().mockRejectedValue(new Error('denied')) });
    vi.stubGlobal('ClipboardItem', class { constructor(_: unknown) {} });
    await expect(writeClipboardHtml('<x/>', 'x')).resolves.toBe(false);
  });

  it('reads back the text/html blob text', async () => {
    // jsdom Blob has no .text(); stub the blob like the ClipboardItem is stubbed.
    const htmlBlob = { text: () => Promise.resolve('<span data-sq-clipboard="AA">x</span>') };
    const emptyBlob = { text: () => Promise.resolve('') };
    stubClipboard({
      read: vi.fn().mockResolvedValue([
        { types: ['text/plain', 'text/html'], getType: (t: string) => Promise.resolve(t === 'text/html' ? htmlBlob : emptyBlob) },
      ]),
    });
    await expect(readClipboardHtml()).resolves.toContain('data-sq-clipboard');
  });

  it('returns null when no html on the clipboard or read refused', async () => {
    stubClipboard({ read: vi.fn().mockRejectedValue(new Error('denied')) });
    await expect(readClipboardHtml()).resolves.toBeNull();
  });
});
