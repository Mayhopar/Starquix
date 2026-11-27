// The dropdown must open fast and show previews: it renders a page of Google rows
// (more as the list scrolls), and every rendered row is observed for its preview.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import fontCatalog from '@/assets/fontCatalog.json';
import { FontFamilySelect } from '../FontFamilySelect';
import { _resetPreviewCacheForTests } from '../fontPreview';

type FakeIO = { cb: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver };
let observers: FakeIO[] = [];
const observed = () => observers.flatMap(o => [...o.targets]);
const intersect = (el: Element) => act(() => {
  for (const o of observers) if (o.targets.has(el)) o.cb([{ isIntersecting: true, target: el } as never], o.self);
});

beforeEach(() => {
  observers = [];
  _resetPreviewCacheForTests();
  document.head.querySelectorAll('link').forEach(l => l.remove());
  vi.stubGlobal('IntersectionObserver', class {
    o: FakeIO;
    constructor(cb: IntersectionObserverCallback) { this.o = { cb, targets: new Set(), self: this as never }; observers.push(this.o); }
    observe(el: Element) { this.o.targets.add(el); }
    unobserve(el: Element) { this.o.targets.delete(el); }
    disconnect() { this.o.targets.clear(); }
  });
});
afterEach(() => vi.unstubAllGlobals());

const open = () => {
  render(<FontFamilySelect value="" projectFonts={{}} onChange={() => {}} onUploadClick={() => {}} />);
  fireEvent.click(screen.getByRole('button'));
};
const googleRows = () => document.querySelectorAll('[data-family]');

describe('FontFamilySelect list', () => {
  it('opens with one page of Google rows, not the whole catalog', () => {
    open();
    expect(googleRows().length).toBe(50);
  });

  it('every rendered row is observed, and a visible row loads its preview', () => {
    open();
    const first = googleRows()[0] as HTMLElement;
    expect(observed()).toContain(first);
    intersect(first);
    expect(document.head.querySelector(`link[href*="family=${first.dataset.family!.replace(/ /g, '+')}"]`)).not.toBeNull();
  });

  it('scrolling to the end of the page renders the next one', () => {
    open();
    intersect(document.querySelector('[data-more]')!);
    expect(googleRows().length).toBe(100);
  });

  it('search reaches every font in the catalog', () => {
    open();
    const last = fontCatalog.families[fontCatalog.families.length - 1].f;
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: last } });
    expect(screen.getByText(last)).toBeTruthy();
  });
});
