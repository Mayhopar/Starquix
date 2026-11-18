// src/services/__tests__/stockImages.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchStockImages } from '../stockImages';

const PHOTO = {
  id: 123, width: 4000, height: 3000, alt: 'Red chair in studio', photographer: 'Ana',
  src: { original: 'https://images.pexels.com/o.jpg', large: 'https://images.pexels.com/l.jpg' },
};

describe('searchStockImages', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('queries pexels with key header and maps results', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ photos: [PHOTO] }) });
    const out = await searchStockImages('red chair', 'pk', { orientation: 'landscape', count: 3 });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('https://api.pexels.com/v1/search?');
    expect(String(url)).toContain('query=red+chair');
    expect(String(url)).toContain('per_page=3');
    expect(String(url)).toContain('orientation=landscape');
    expect(init.headers.Authorization).toBe('pk');
    expect(out).toEqual([{ id: 123, alt: 'Red chair in studio', width: 4000, height: 3000, photographer: 'Ana', url: 'https://images.pexels.com/l.jpg' }]);
  });

  it('caps count at 10 and defaults to 5', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ photos: [] }) });
    await searchStockImages('x', 'pk', { count: 50 });
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('per_page=10');
    await searchStockImages('x', 'pk');
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[1][0])).toContain('per_page=5');
  });

  it('returns [] for empty results and throws on non-ok', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await searchStockImages('x', 'pk')).toEqual([]);
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, text: async () => 'Too many' });
    await expect(searchStockImages('x', 'pk')).rejects.toThrow(/429/);
  });

  it('falls back to src.original when large missing, alt to empty string', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ photos: [{ ...PHOTO, alt: null, src: { original: 'https://images.pexels.com/o.jpg' } }] }),
    });
    const out = await searchStockImages('x', 'pk');
    expect(out[0].url).toBe('https://images.pexels.com/o.jpg');
    expect(out[0].alt).toBe('');
  });
});
