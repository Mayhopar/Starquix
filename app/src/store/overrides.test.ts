// src/store/overrides.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  createOverrideAPI,
  getInstanceOverrideAPI,
  type OverrideAPI,
} from './overrides';
import type { SerializedOverrides } from './types';

describe('OverrideAPI', () => {
  let doc: Y.Doc;
  let overrideMap: Y.Map<unknown>;
  let api: OverrideAPI;

  beforeEach(() => {
    doc = new Y.Doc();
    overrideMap = doc.getMap('testOverrides');
    api = createOverrideAPI(overrideMap);
  });

  describe('getOverride', () => {
    it('returns undefined for non-existent selector', () => {
      expect(api.getOverride('p-0')).toBeUndefined();
    });

    it('returns the override for existing selector', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      const result = api.getOverride('p-0');
      expect(result?.styles).toEqual({ color: 'red' });
    });
  });

  describe('setOverride', () => {
    it('creates new override entry', () => {
      api.setOverride('h1-0', { styles: { fontSize: '24px' } });
      expect(api.hasOverride('h1-0')).toBe(true);
    });

    it('merges with existing override', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.setOverride('p-0', { classes: { base: ['text-lg'], sm: [], md: [], lg: [], xl: [], '2xl': [] } });

      const result = api.getOverride('p-0');
      expect(result?.styles).toEqual({ color: 'red' });
      expect(result?.classes?.base).toEqual(['text-lg']);
    });

    it('overwrites existing field when set again', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.setOverride('p-0', { styles: { color: 'blue' } });

      const result = api.getOverride('p-0');
      expect(result?.styles?.color).toBe('blue');
    });
  });

  describe('clearOverride', () => {
    it('removes entire override when no types specified', () => {
      api.setOverride('p-0', { styles: { color: 'red' }, content: { type: 'text', value: 'hi' } });
      api.clearOverride('p-0');
      expect(api.hasOverride('p-0')).toBe(false);
    });

    it('removes only specified types', () => {
      api.setOverride('p-0', {
        styles: { color: 'red' },
        content: { type: 'text', value: 'hi' },
      });
      api.clearOverride('p-0', ['styles']);

      const result = api.getOverride('p-0');
      expect(result?.styles).toBeUndefined();
      expect(result?.content?.value).toBe('hi');
    });
  });

  describe('hasOverride', () => {
    it('returns false for non-existent selector', () => {
      expect(api.hasOverride('p-0')).toBe(false);
    });

    it('returns true for existing selector', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      expect(api.hasOverride('p-0')).toBe(true);
    });

    it('checks specific types', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      expect(api.hasOverride('p-0', ['styles'])).toBe(true);
      expect(api.hasOverride('p-0', ['content'])).toBe(false);
    });
  });

  describe('setContent', () => {
    it('sets text content', () => {
      api.setContent('p-0', 'Hello World', 'text');
      const result = api.getOverride('p-0');
      expect(result?.content).toEqual({ type: 'text', value: 'Hello World' });
    });

    it('sets markup content', () => {
      api.setContent('p-0', '<a href="#">Link</a>', 'markup');
      const result = api.getOverride('p-0');
      expect(result?.content).toEqual({ type: 'markup', value: '<a href="#">Link</a>' });
    });

    it('markup overwrites text (precedence rule)', () => {
      api.setContent('p-0', 'Hello', 'text');
      api.setContent('p-0', '<b>Bold</b>', 'markup');
      const result = api.getOverride('p-0');
      expect(result?.content?.type).toBe('markup');
    });

    it('text overwrites markup', () => {
      api.setContent('p-0', '<b>Bold</b>', 'markup');
      api.setContent('p-0', 'Plain text', 'text');
      const result = api.getOverride('p-0');
      expect(result?.content?.type).toBe('text');
    });
  });

  describe('setHref', () => {
    it('sets href on a selector', () => {
      api.setHref('a-0', 'https://example.com');
      const result = api.getOverride('a-0');
      expect(result?.href).toEqual({ href: 'https://example.com', target: undefined });
    });

    it('sets href with target _blank', () => {
      api.setHref('a-0', 'https://example.com', '_blank');
      const result = api.getOverride('a-0');
      expect(result?.href).toEqual({ href: 'https://example.com', target: '_blank' });
    });

    it('sets href with target _self', () => {
      api.setHref('a-0', '/about', '_self');
      const result = api.getOverride('a-0');
      expect(result?.href).toEqual({ href: '/about', target: '_self' });
    });

    it('overwrites existing href', () => {
      api.setHref('a-0', 'https://old.com', '_blank');
      api.setHref('a-0', 'https://new.com');
      const result = api.getOverride('a-0');
      expect(result?.href?.href).toBe('https://new.com');
      // target should be cleared when not provided
      expect(result?.href?.target).toBeUndefined();
    });

    it('preserves other override types on same selector', () => {
      api.setOverride('a-0', { styles: { color: 'red' } });
      api.setHref('a-0', 'https://example.com');
      const result = api.getOverride('a-0');
      expect(result?.styles).toEqual({ color: 'red' });
      expect(result?.href?.href).toBe('https://example.com');
    });
  });

  describe('getAllSelectors', () => {
    it('returns empty array when no overrides exist', () => {
      expect(api.getAllSelectors()).toEqual([]);
    });

    it('returns all selectors with overrides', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.setOverride('h1-0', { content: { type: 'text', value: 'Hello' } });
      api.setHref('a-0', 'https://example.com');

      const selectors = api.getAllSelectors();
      expect(selectors).toHaveLength(3);
      expect(selectors).toContain('p-0');
      expect(selectors).toContain('h1-0');
      expect(selectors).toContain('a-0');
    });

    it('does not include cleared selectors', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.setOverride('p-1', { styles: { color: 'blue' } });
      api.clearOverride('p-0');

      const selectors = api.getAllSelectors();
      expect(selectors).toEqual(['p-1']);
    });
  });

  describe('isEmpty', () => {
    it('returns true when no overrides exist', () => {
      expect(api.isEmpty()).toBe(true);
    });

    it('returns false when overrides exist', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      expect(api.isEmpty()).toBe(false);
    });

    it('returns true after all overrides are cleared', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.clearOverride('p-0');
      expect(api.isEmpty()).toBe(true);
    });
  });

  describe('resetAll', () => {
    it('removes all overrides', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.setOverride('h1-0', { content: { type: 'text', value: 'Hello' } });
      api.setHref('a-0', 'https://example.com');

      api.resetAll();

      expect(api.isEmpty()).toBe(true);
      expect(api.getAllSelectors()).toEqual([]);
      expect(api.getOverride('p-0')).toBeUndefined();
      expect(api.getOverride('h1-0')).toBeUndefined();
      expect(api.getOverride('a-0')).toBeUndefined();
    });

    it('is a no-op when already empty', () => {
      api.resetAll();
      expect(api.isEmpty()).toBe(true);
    });

    it('allows adding new overrides after reset', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.resetAll();
      api.setOverride('p-1', { styles: { color: 'blue' } });

      expect(api.isEmpty()).toBe(false);
      expect(api.getOverride('p-1')?.styles?.color).toBe('blue');
      expect(api.getOverride('p-0')).toBeUndefined();
    });
  });

  describe('getSnapshot / restoreSnapshot', () => {
    it('creates a serializable snapshot', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.setContent('h1-0', 'Title', 'text');

      const snapshot = api.getSnapshot();

      expect(snapshot.version).toBe(2);
      expect(snapshot.entries['p-0'].styles).toEqual({ color: 'red' });
      expect(snapshot.entries['h1-0'].content).toEqual({ type: 'text', value: 'Title' });
    });

    it('restores from snapshot', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });

      const snapshot = api.getSnapshot();

      // Modify state
      api.setOverride('p-0', { styles: { color: 'blue' } });
      api.setContent('h1-0', 'New', 'text');

      // Restore
      api.restoreSnapshot(snapshot);

      expect(api.getOverride('p-0')?.styles?.color).toBe('red');
      expect(api.hasOverride('h1-0')).toBe(false);
    });

    it('restore clears entries not in snapshot', () => {
      api.setOverride('p-0', { styles: { color: 'red' } });
      api.setOverride('p-1', { styles: { color: 'blue' } });

      const snapshot: SerializedOverrides = {
        version: 2,
        entries: {
          'p-0': { styles: { color: 'green' } },
        },
      };

      api.restoreSnapshot(snapshot);

      expect(api.hasOverride('p-0')).toBe(true);
      expect(api.hasOverride('p-1')).toBe(false);
    });
  });
});

describe('getInstanceOverrideAPI', () => {
  let doc: Y.Doc;
  let elements: Y.Map<unknown>;

  beforeEach(() => {
    doc = new Y.Doc();
    elements = doc.getMap('elements');

    // Create a test instance element
    const instance = new Y.Map();
    instance.set('id', 'el-test');
    instance.set('type', 'instance');
    elements.set('el-test', instance);
  });

  it('creates override map if not exists', () => {
    const api = getInstanceOverrideAPI(elements, 'el-test');
    expect(api).toBeDefined();

    api!.setContent('p-0', 'Hello', 'text');

    const instance = elements.get('el-test') as Y.Map<unknown>;
    const overrides = instance.get('unifiedOverrides') as Y.Map<unknown>;
    expect(overrides).toBeDefined();
  });

  it('returns null for non-existent instance', () => {
    const api = getInstanceOverrideAPI(elements, 'non-existent');
    expect(api).toBeNull();
  });

  it('reuses existing override map', () => {
    const api1 = getInstanceOverrideAPI(elements, 'el-test');
    api1?.setContent('p-0', 'First', 'text');

    const api2 = getInstanceOverrideAPI(elements, 'el-test');
    expect(api2?.getOverride('p-0')?.content?.value).toBe('First');
  });
});
