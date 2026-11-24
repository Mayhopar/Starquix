// The editor says a newer release is out (the Projects banner misses anyone who opens a project at launch),
// once per app run after the user answers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import toast, { Toaster } from 'react-hot-toast';
import type { UpdateState } from '@/hooks/useDesktopUpdate';
import { UpdateToast, _resetUpdateToastForTests } from '../UpdateToast';

const page = 'https://github.com/Mayhopar/Starquix/releases/tag/v0.3.3';
function Host() { return <><UpdateToast /><Toaster /></>; }
function desktop(initial: UpdateState) {
  let push: (state: UpdateState) => void = () => {};
  vi.stubGlobal('sqDesktop', { update: { state: async () => initial,
    onState: (callback: (state: UpdateState) => void) => { push = callback; return () => {}; } } });
  return (state: UpdateState) => act(() => { push(state); });
}

beforeEach(() => {
  _resetUpdateToastForTests();
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('UpdateToast', () => {
  it('no desktop or already latest: nothing; a release main finds later shows up live', async () => {
    const push = desktop({ current: '0.3.2', latest: null, page: null });
    render(<Host />);
    await act(async () => {});
    expect(screen.queryByText(/is available/)).toBeNull();
    push({ current: '0.3.2', latest: '0.3.3', page });
    expect(await screen.findByText('Starquix 0.3.3 is available.')).toBeTruthy();
  });

  it('Update opens the release page; after an answer, reopening a project stays quiet this run', async () => {
    desktop({ current: '0.3.2', latest: '0.3.3', page });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const first = render(<Host />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update' }));
    expect(open).toHaveBeenCalledWith(page, '_blank', 'noopener,noreferrer');
    first.unmount(); toast.remove(); // a dismissed toast lingers ~1 s in the store: start the next project clean
    render(<Host />);
    await act(async () => {});
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('unanswered: leaving the editor takes it down and the next project shows it again', async () => {
    desktop({ current: '0.3.2', latest: '0.3.3', page });
    const first = render(<Host />);
    expect(await screen.findByText('Starquix 0.3.3 is available.')).toBeTruthy();
    first.unmount(); toast.remove();
    render(<Host />);
    expect(await screen.findByText('Starquix 0.3.3 is available.')).toBeTruthy();
  });
});
