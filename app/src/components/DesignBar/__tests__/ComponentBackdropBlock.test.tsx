// Component view, nothing selected → Backdrop: one journaled write of the
// component file's `@sq-backdrop` note; Reset removes it (owner 2026-10-10).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ src: '', rewrite: vi.fn(), takeSnapshot: vi.fn(), snapshot: { commit: () => {} } }));
vi.mock('@/utils/localElementSource', () => ({ readLocalFile: async () => h.src, rewriteLocalFile: (...a: unknown[]) => h.rewrite(...a) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: h.takeSnapshot, claimSnapshot: () => h.snapshot }) }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://p' }));
vi.mock('@/hooks/useLocalPageLayout', () => ({ useLocalScanVersion: () => 0 }));
vi.mock('../ColorPicker', () => ({ ColorPicker: ({ value, onChange }: { value: string; onChange: (c: string, hex: string) => void }) => (
  <button type="button" data-value={value} onClick={() => onChange('bg-[#111827]', '#111827')}>pick</button>
) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

import { ComponentBackdropBlock } from '../blocks/ComponentBackdropBlock';

const CARD = `---\n/**\n * @name BlogCard\n */\n---\n<article />\n`;
beforeEach(() => { h.rewrite.mockReset().mockResolvedValue({ created: false, changed: true }); h.takeSnapshot.mockReset(); });

describe('ComponentBackdropBlock', () => {
  it('picking a color writes the note into the component file (one snapshot)', async () => {
    h.src = CARD;
    render(<ComponentBackdropBlock file="src/components/BlogCard.astro" />);
    fireEvent.click(screen.getByText('pick'));
    await waitFor(() => expect(h.rewrite).toHaveBeenCalledTimes(1));
    const [file, compute, snapshot] = h.rewrite.mock.calls[0] as [string, (s: string) => string, unknown];
    expect(file).toBe('src/components/BlogCard.astro');
    expect(compute(CARD)).toContain(' * @sq-backdrop #111827');
    expect(snapshot).toBe(h.snapshot);
    expect(h.takeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('shows the file\'s color; Reset removes the note', async () => {
    h.src = CARD.replace(' * @name BlogCard\n', ' * @name BlogCard\n * @sq-backdrop #000000\n');
    render(<ComponentBackdropBlock file="src/components/BlogCard.astro" />);
    await waitFor(() => expect(screen.getByText('pick').getAttribute('data-value')).toBe('bg-[#000000]'));
    fireEvent.click(screen.getByText('Reset'));
    await waitFor(() => expect(h.rewrite).toHaveBeenCalled());
    expect((h.rewrite.mock.calls[0][1] as (s: string) => string)(h.src)).toBe(CARD);
  });
});
