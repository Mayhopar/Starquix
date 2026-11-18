/**
 * Finding 29 — unit coverage for the local double-navigation guard:
 * normalizeLocalRoute (now shared between the announce handler and the src
 * decision) and resolveLocalIframeSrc (the skip rule itself). The component
 * wiring is covered by ViewportFrame.localSrcSkip.test.tsx.
 */
import { describe, it, expect } from 'vitest';
import { normalizeLocalRoute, resolveLocalIframeSrc } from '../previewSrc';

describe('normalizeLocalRoute', () => {
  it('keeps the same semantics the announce handler always had', () => {
    expect(normalizeLocalRoute('/about')).toBe('/about');
    expect(normalizeLocalRoute('/about/')).toBe('/about');
    expect(normalizeLocalRoute('/about?q=1')).toBe('/about');
    expect(normalizeLocalRoute('/about#frag')).toBe('/about');
    expect(normalizeLocalRoute('/index.html')).toBe('/');
    expect(normalizeLocalRoute('/index.htm')).toBe('/');
    expect(normalizeLocalRoute('')).toBe('/');
    expect(normalizeLocalRoute('/')).toBe('/');
  });
});

const URL_BASE = 'http://localhost:5001';

describe('resolveLocalIframeSrc (finding 29)', () => {
  it('never skips on the first render (nothing rendered yet)', () => {
    const d = resolveLocalIframeSrc({
      desiredSrc: `${URL_BASE}/about`,
      desiredRoute: '/about',
      nativeRoute: '/about',
      lastRendered: null,
    });
    expect(d).toEqual({ src: `${URL_BASE}/about`, route: '/about', skipped: false });
  });

  it('skips the attribute re-set when the desired route is the one the frame reached natively', () => {
    const d = resolveLocalIframeSrc({
      desiredSrc: `${URL_BASE}/about`,
      desiredRoute: '/about',
      nativeRoute: '/about',
      lastRendered: { src: `${URL_BASE}/`, route: '/' },
    });
    expect(d.skipped).toBe(true);
    expect(d.src).toBe(`${URL_BASE}/`); // attribute left untouched
    expect(d.route).toBe('/');
  });

  it('preserves src for a hash-only override update on the current document', () => {
    const d = resolveLocalIframeSrc({
      desiredSrc: `${URL_BASE}/about#sq-ov=abc`,
      desiredRoute: '/about',
      nativeRoute: '/about',
      lastRendered: { src: `${URL_BASE}/about`, route: '/about' },
    });
    expect(d.skipped).toBe(true);
    expect(d.src).toBe(`${URL_BASE}/about`);
  });

  it('does NOT skip a programmatic navigation to a route other than the native one', () => {
    const d = resolveLocalIframeSrc({
      desiredSrc: `${URL_BASE}/contact`,
      desiredRoute: '/contact',
      nativeRoute: '/about',
      lastRendered: { src: `${URL_BASE}/`, route: '/' },
    });
    expect(d.skipped).toBe(false);
    expect(d.src).toBe(`${URL_BASE}/contact`);
  });

  it('does NOT skip with no native navigation recorded', () => {
    const d = resolveLocalIframeSrc({
      desiredSrc: `${URL_BASE}/about`,
      desiredRoute: '/about',
      nativeRoute: null,
      lastRendered: { src: `${URL_BASE}/`, route: '/' },
    });
    expect(d.skipped).toBe(false);
  });

  it('does NOT skip boot/error transitions (desiredRoute null = about:blank)', () => {
    const d = resolveLocalIframeSrc({
      desiredSrc: 'about:blank',
      desiredRoute: null,
      nativeRoute: '/about',
      lastRendered: { src: `${URL_BASE}/about`, route: '/about' },
    });
    expect(d.skipped).toBe(false);
    expect(d.src).toBe('about:blank');
    expect(d.route).toBeNull();
  });

  it('recovery after an instance restart re-navigates: a stale lastRendered route of null never satisfies the skip when native was consumed', () => {
    // After the restart-to-blank render the reconciliation clears the native
    // marker (route null !== native) — so the recovery render must navigate.
    const d = resolveLocalIframeSrc({
      desiredSrc: `${URL_BASE}/about`,
      desiredRoute: '/about',
      nativeRoute: null,
      lastRendered: { src: 'about:blank', route: null },
    });
    expect(d.skipped).toBe(false);
    expect(d.src).toBe(`${URL_BASE}/about`);
  });
});


describe('same-document override updates', () => {
  it('does not mistake a sidebar return to a stale attribute route for a hash-only change', () => {
    expect(resolveLocalIframeSrc({ desiredSrc: `${URL_BASE}/#sq-ov=next`, desiredRoute: '/', nativeRoute: '/about', lastRendered: { src: `${URL_BASE}/#sq-ov=old`, route: '/' } }).skipped).toBe(false);
  });
  it.each(['#sq-ov=next', ''])('preserves src when replacing/removing overrides: %s', hash => {
    const src = `${URL_BASE}/about?q=1#sq-ov=old`;
    expect(resolveLocalIframeSrc({ desiredSrc: `${URL_BASE}/about?q=1${hash}`, desiredRoute: '/about', nativeRoute: null, lastRendered: { src, route: '/about' } })).toEqual({ src, route: '/about', skipped: true });
  });
  it.each(['http://localhost:5002/about?q=1', `${URL_BASE}/about?q=2`, `${URL_BASE}/about/?q=1`, `${URL_BASE}/index.html?q=1`])('navigates for a changed full document URL: %s', desiredSrc => {
    const d = resolveLocalIframeSrc({ desiredSrc, desiredRoute: '/about', nativeRoute: null, lastRendered: { src: `${URL_BASE}/about?q=1#sq-ov=old`, route: '/about' } });
    expect(d).toEqual({ src: desiredSrc, route: '/about', skipped: false });
  });
  it.each(['http://localhost:5002/about', `${URL_BASE}/about?q=2`])('does not let a native marker swallow instance/query changes: %s', desiredSrc => {
    expect(resolveLocalIframeSrc({ desiredSrc, desiredRoute: '/about', nativeRoute: '/about', lastRendered: { src: `${URL_BASE}/`, route: '/' } }).skipped).toBe(false);
  });
});


it('keeps the attribute for an authenticated exact native document despite canonical query differences', () => {
  expect(resolveLocalIframeSrc({ desiredSrc: 'https://instance.test/about/?q=1#sq-ov=x', desiredRoute: '/about', nativeRoute: null,
    confirmedDocumentSrc: 'https://instance.test/about/?q=1', lastRendered: { src: 'https://instance.test/', route: '/' } })).toEqual({ src: 'https://instance.test/', route: '/', skipped: true });
});
