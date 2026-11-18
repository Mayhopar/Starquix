import { describe, it, expect, vi, beforeEach } from 'vitest';
import { materializeIconComponent } from '../iconLibrary';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 12h14"/></svg>';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true })); });

describe('materializeIconComponent', () => {
  it('writes library/icons/<Name>.astro via /__sq/save-component', async () => {
    const r = await materializeIconComponent('ArrowRight', SVG, new Set());
    expect(r).toEqual({ componentName: 'IconArrowRight', created: true });
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/__sq/save-component');
    const body = JSON.parse(init.body);
    expect(body.name).toBe('IconArrowRight');
    expect(body.category).toBe('icons');
    expect(body.astroContent).toBe(`---\n---\n${SVG}\n`);
  });

  it('dedupes: existing component name skips the write', async () => {
    const r = await materializeIconComponent('ArrowRight', SVG, new Set(['IconArrowRight']));
    expect(r.created).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates write failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 });
    await expect(materializeIconComponent('X', SVG, new Set())).rejects.toThrow();
  });
});
