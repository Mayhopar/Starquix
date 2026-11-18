// Phase 1 of docs/archive/plans/2026-06-10-selection-key-architecture-memo.md:
// one classifier for the overloaded selection key, replacing the ad-hoc
// `.includes('[pageId].astro')` / `parseKey` / prefix checks scattered
// across consumers. Covers every kind in the memo's §9.3 cheat sheet.
import { describe, it, expect } from 'vitest';
import { classifyKey, isWrapperKey, isUserSelectable, isComponentInstanceContainerKey } from '../keyKind';

describe('classifyKey', () => {
  it('classifies a source element key (file:line:col)', () => {
    expect(classifyKey('library/Hero.astro:5:1')).toEqual({
      kind: 'source',
      file: 'library/Hero.astro',
      line: 5,
      col: 1,
    });
  });

  it('classifies the #sq-components infrastructure wrapper BEFORE source (it is also file:line:col shaped)', () => {
    expect(
      classifyKey('src/pages/preview/[projectId]/[pageId].astro:17:29')
    ).toEqual({ kind: 'wrapper' });
  });

  it('classifies a bare layoutchrome-<pageId> key as layout-chrome with its pageId', () => {
    expect(classifyKey('layoutchrome-page-91')).toEqual({
      kind: 'layout-chrome',
      pageId: 'page-91',
    });
  });

  it('classifies a layout-chrome CHILD as instance-child, not layout-chrome', () => {
    expect(classifyKey('layoutchrome-page-91:slot-0')).toEqual({
      kind: 'instance-child',
      instanceId: 'layoutchrome-page-91',
      selector: 'slot-0',
    });
  });

  it('classifies an instance root (Yjs element id)', () => {
    expect(classifyKey('el-1781117386992-d393n88')).toEqual({
      kind: 'instance-root',
      instanceId: 'el-1781117386992-d393n88',
    });
  });

  it('classifies a drawn element as instance-root (drawn keys share the shape)', () => {
    expect(classifyKey('drawn-abc123')).toEqual({
      kind: 'instance-root',
      instanceId: 'drawn-abc123',
    });
  });

  it('classifies an instance child (instanceId:tag-N)', () => {
    expect(classifyKey('el-abc123:section-0')).toEqual({
      kind: 'instance-child',
      instanceId: 'el-abc123',
      selector: 'section-0',
    });
  });

  it('returns null for null / undefined / empty', () => {
    expect(classifyKey(null)).toBeNull();
    expect(classifyKey(undefined)).toBeNull();
    expect(classifyKey('')).toBeNull();
  });

  it('returns null for a malformed source-shaped key, matching parseKey', () => {
    // parseKey returns null for source-shaped keys without numeric line:col
    expect(classifyKey('library/Hero.astro')).toBeNull();
  });
});

describe('isWrapperKey', () => {
  it('is true only for the [pageId].astro wrapper key', () => {
    expect(isWrapperKey('src/pages/preview/[projectId]/[pageId].astro:17:29')).toBe(true);
    expect(isWrapperKey('library/Hero.astro:5:1')).toBe(false);
    expect(isWrapperKey('layoutchrome-page-91')).toBe(false);
    expect(isWrapperKey(null)).toBe(false);
    expect(isWrapperKey(undefined)).toBe(false);
  });
});

describe('isUserSelectable', () => {
  it('is false for the infrastructure wrapper and for no key', () => {
    expect(isUserSelectable('src/pages/preview/[projectId]/[pageId].astro:17:29')).toBe(false);
    expect(isUserSelectable(null)).toBe(false);
    expect(isUserSelectable(undefined)).toBe(false);
  });

  it('is true for every user-facing kind', () => {
    expect(isUserSelectable('library/Hero.astro:5:1')).toBe(true);
    expect(isUserSelectable('layoutchrome-page-91')).toBe(true);
    expect(isUserSelectable('el-1781117386992-d393n88')).toBe(true);
    expect(isUserSelectable('el-abc123:section-0')).toBe(true);
    expect(isUserSelectable('drawn-abc123')).toBe(true);
  });
});

describe('isComponentInstanceContainerKey', () => {
  // task-069 A1: a component/theme INSTANCE (placed on a page) is locked — it can
  // never parent a foreign drawn element. Both theme instances and local
  // components carry `el-…` ids, so the instance-id prefix is the lock signal.
  it('flags component/theme instance keys (el-)', () => {
    expect(isComponentInstanceContainerKey('el-abc')).toBe(true);
    expect(isComponentInstanceContainerKey('el-abc:div-2')).toBe(true);
  });
  it('does NOT flag drawn containers, page-source, layout-chrome, or null', () => {
    expect(isComponentInstanceContainerKey('drawn-123')).toBe(false);
    expect(isComponentInstanceContainerKey('drawn-123:div-0')).toBe(false);
    expect(isComponentInstanceContainerKey('src/pages/index.astro:5:1')).toBe(false);
    expect(isComponentInstanceContainerKey('layoutchrome-page1')).toBe(false);
    expect(isComponentInstanceContainerKey('layoutchrome-page1:slot-0')).toBe(false);
    expect(isComponentInstanceContainerKey(null)).toBe(false);
    expect(isComponentInstanceContainerKey(undefined)).toBe(false);
  });
});
