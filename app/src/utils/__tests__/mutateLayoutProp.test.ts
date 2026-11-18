import { describe, it, expect, vi, afterEach } from 'vitest';
import { mutateLayoutProp } from '../mutateLayoutProp';

afterEach(() => { vi.restoreAllMocks(); });

describe('mutateLayoutProp', () => {
  it('POSTs to /__sq/layout-prop and resolves ok on success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const r = await mutateLayoutProp('Marketing', 'add', 'cta');
    expect(r).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledWith('/__sq/layout-prop', expect.objectContaining({ method: 'POST' }));
  });

  it('returns the server error message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), { status: 400 }),
    );
    expect(await mutateLayoutProp('Marketing', 'remove', 'cta')).toEqual({ ok: false, error: 'boom' });
  });
});
