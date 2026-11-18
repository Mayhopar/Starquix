/**
 * task-120 (6.3) — boot overlay shows the Dexie cover screenshot when one
 * exists; plain spinner fallback otherwise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BootCoverOverlay } from '../BootCoverOverlay';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('@/db', () => ({
  db: { assets: { get: mockGet } },
  getAssetBlob: () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
}));

describe('BootCoverOverlay', () => {
  beforeEach(() => {
    mockGet.mockReset();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => 'blob:cover-url'),
      revokeObjectURL: vi.fn(),
    }));
  });

  it('renders the blurred cover when the project has a screenshot', async () => {
    mockGet.mockResolvedValue({ id: 'cover_p1', blob: new ArrayBuffer(3), mimeType: 'image/jpeg' });
    const { getByTestId } = render(<BootCoverOverlay projectId="p1" />);
    await waitFor(() => {
      expect(getByTestId('boot-cover').getAttribute('src')).toBe('blob:cover-url');
    });
    expect(mockGet).toHaveBeenCalledWith('cover_p1');
  });

  it('falls back to the spinner-only overlay when no cover exists', async () => {
    mockGet.mockResolvedValue(undefined);
    const { container, queryByTestId } = render(<BootCoverOverlay projectId="p1" />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(queryByTestId('boot-cover')).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('no projectId → spinner only, no Dexie read', () => {
    const { container } = render(<BootCoverOverlay projectId={null} />);
    expect(mockGet).not.toHaveBeenCalled();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });
});
