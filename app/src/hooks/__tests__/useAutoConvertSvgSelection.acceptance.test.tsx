import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useAutoConvertSvgSelection } from '../useAutoConvertSvgSelection';

const state = vi.hoisted(() => ({ convert: vi.fn(), scannedByKeyRef: { current: new Map() } }));
vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({ selectedKey: 'instance:svg-0' }),
  useScannedElementsRef: () => ({ scannedByKeyRef: state.scannedByKeyRef }),
}));
vi.mock('@/hooks/useConvertSvgToShape', () => ({ useConvertSvgToShape: () => state.convert }));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('releases a transient storage reservation and retries the same selected SVG', async () => {
  vi.useFakeTimers();
  state.convert.mockRejectedValueOnce(new Error('quota')).mockResolvedValue(true);
  const view = renderHook(useAutoConvertSvgSelection);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(state.convert).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('keeps unsupported SVGs reserved without a retry loop', async () => {
  vi.useFakeTimers(); state.convert.mockResolvedValue(false);
  const view = renderHook(useAutoConvertSvgSelection);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(state.convert).toHaveBeenCalledTimes(1); view.unmount();
});
