// task-136/137 regression: local component-view desync — canvas stuck on the
// component after File-tab switch, and Assets "shows the main page" because
// the still-highlighted row no-ops on re-click. Reproduced live 2026-08-01.
import { describe, it, expect } from 'vitest';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { shouldExitLocalComponentView, shouldSkipReselect, shouldRefuseBuiltInInLocal } from '../componentViewGates';

describe('shouldExitLocalComponentView', () => {
  it('exits when switching to File tab with a local component open (page id never changed)', () => {
    expect(shouldExitLocalComponentView('pages', 'src/components/Back.astro', 'local:/')).toBe(true);
  });

  it('does not double-fire for the WC doc-seeded flow (COMPONENT_PAGE_ID handles it)', () => {
    expect(shouldExitLocalComponentView('pages', 'library/Hero.astro', COMPONENT_EDITOR_PAGE_ID)).toBe(false);
  });

  it('no-op when no component view is open or when not entering the File tab', () => {
    expect(shouldExitLocalComponentView('pages', null, 'local:/')).toBe(false);
    expect(shouldExitLocalComponentView('assets', 'src/components/Back.astro', 'local:/')).toBe(false);
  });
});

describe('shouldSkipReselect', () => {
  it('user-project components re-dispatch even when already active (heals desync)', () => {
    expect(shouldSkipReselect('user-project', 'src/components/Back.astro', 'src/components/Back.astro')).toBe(false);
  });

  it('WC/built-in components keep the same-path no-op', () => {
    expect(shouldSkipReselect('built-in', 'library/Hero.astro', 'library/Hero.astro')).toBe(true);
  });

  it('different path never skips', () => {
    expect(shouldSkipReselect('built-in', 'library/Hero.astro', 'library/Card.astro')).toBe(false);
  });
});

describe('shouldRefuseBuiltInInLocal', () => {
  it('refuses built-in components in local mode (their editor page 404s)', () => {
    expect(shouldRefuseBuiltInInLocal('/Users/x/site', 'built-in')).toBe(true);
    expect(shouldRefuseBuiltInInLocal('/Users/x/site', undefined)).toBe(true);
  });
  it('user components and layouts pass in local mode', () => {
    expect(shouldRefuseBuiltInInLocal('/Users/x/site', 'user-project')).toBe(false);
  });
  it('never refuses outside local mode', () => {
    expect(shouldRefuseBuiltInInLocal(null, 'built-in')).toBe(false);
  });
});
