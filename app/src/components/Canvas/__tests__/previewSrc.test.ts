import { describe, it, expect } from 'vitest';
import { buildPreviewSrc } from '../previewSrc';

describe('buildPreviewSrc (Phase 6: ONE runtime — the iframe IS the site)', () => {
  const running = { status: 'running' as const, url: 'http://localhost:4999' };
  it('running instance → the real route, with the pre-paint override hash', () => {
    expect(buildPreviewSrc({ localInstanceState: running, currentPagePath: '/about' })).toBe('http://localhost:4999/about');
    expect(buildPreviewSrc({ localInstanceState: running, currentPagePath: '/', localOverridesHash: '#sq-ov=x' })).toBe('http://localhost:4999/#sq-ov=x');
    expect(buildPreviewSrc({ localInstanceState: running })).toBe('http://localhost:4999/');
  });
  it('not running / no instance → about:blank (the overlay owns the surface)', () => {
    expect(buildPreviewSrc({ localInstanceState: { status: 'starting', url: null } })).toBe('about:blank');
    expect(buildPreviewSrc({})).toBe('about:blank');
  });
});
