// The refusal must not be a dead end: it names the component and offers the
// one-click route into the component view, where the same edit is legal.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toaster } from 'react-hot-toast';

import { useLocalCrossFileToast, openLocalComponentFile } from '../useLocalCrossFileToast';
import { notifyLocalCrossFileWrite } from '@/utils/localWriteScope';

const COMPONENT = 'src/components/Header.astro';

function Host() {
  useLocalCrossFileToast();
  return <Toaster />;
}

// react-hot-toast's <Toaster> reads prefers-reduced-motion; jsdom has no matchMedia.
beforeEach(() => {
  vi.useRealTimers();
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

describe('useLocalCrossFileToast', () => {
  it('a refusal toasts the component name and an Open action', async () => {
    render(<Host />);
    notifyLocalCrossFileWrite(COMPONENT);
    expect(await screen.findByText(/Header\.astro is a component/)).toBeTruthy();

    const opened: string[] = [];
    const h = (e: Event) => opened.push((e as CustomEvent).detail.path);
    window.addEventListener('sq:go-to-source-component', h);
    fireEvent.click(screen.getByText('Open'));
    window.removeEventListener('sq:go-to-source-component', h);

    // Reuses the EXACT navigation the Assets panel uses — no parallel route.
    expect(opened).toEqual([COMPONENT]);
  });

  it('openLocalComponentFile dispatches the Assets-panel navigation event', () => {
    const seen: string[] = [];
    const h = (e: Event) => seen.push((e as CustomEvent).detail.path);
    window.addEventListener('sq:go-to-source-component', h);
    openLocalComponentFile(COMPONENT);
    window.removeEventListener('sq:go-to-source-component', h);
    expect(seen).toEqual([COMPONENT]);
  });
});
