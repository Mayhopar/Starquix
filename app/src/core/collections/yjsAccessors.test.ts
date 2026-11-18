import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  readBlogSlotBinding,
  readAllBlogSlotBindings,
  readResolvedStaticMarkup,
  readDrawnElementClasses,
  readBlogSettingsFromYSlot,
} from './yjsAccessors';
import { DEFAULT_BLOG_SETTINGS } from './types';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe('yjsAccessors', () => {
  describe('readBlogSlotBinding', () => {
    it('returns null when slot key is missing', () => {
      const doc = new Y.Doc();
      expect(readBlogSlotBinding(doc, 'nope')).toBeNull();
    });

    it('returns null when binding has no collectionId', () => {
      const doc = new Y.Doc();
      const ySlot = new Y.Map();
      doc.getMap('blogSlotBindings').set('slot-1', ySlot);
      expect(readBlogSlotBinding(doc, 'slot-1')).toBeNull();
    });

    it('fills in defaults for missing settings fields', () => {
      const doc = new Y.Doc();
      const ySlot = new Y.Map();
      ySlot.set('collectionId', 'coll-1');
      doc.getMap('blogSlotBindings').set('slot-1', ySlot);

      const result = readBlogSlotBinding(doc, 'slot-1');
      expect(result).not.toBeNull();
      expect(result!.collectionId).toBe('coll-1');
      expect(result!.settings.postsPerPage).toBe(DEFAULT_BLOG_SETTINGS.postsPerPage);
      expect(result!.settings.pagination).toBe(DEFAULT_BLOG_SETTINGS.pagination);
      expect(result!.bindings).toEqual({});
    });

    it('reads through stored settings when present', () => {
      const doc = new Y.Doc();
      const ySlot = new Y.Map();
      ySlot.set('collectionId', 'coll-1');
      const ySettings = new Y.Map();
      ySettings.set('postsPerPage', 12);
      ySettings.set('pagination', 'numbered');
      ySlot.set('settings', ySettings);
      const yBindings = new Y.Map();
      yBindings.set('h1-0', 'title');
      ySlot.set('bindings', yBindings);
      doc.getMap('blogSlotBindings').set('slot-1', ySlot);

      const result = readBlogSlotBinding(doc, 'slot-1')!;
      expect(result.settings.postsPerPage).toBe(12);
      expect(result.settings.pagination).toBe('numbered');
      expect(result.bindings).toEqual({ 'h1-0': 'title' });
    });
  });

  describe('readAllBlogSlotBindings', () => {
    it('returns {} for an empty doc', () => {
      expect(readAllBlogSlotBindings(new Y.Doc())).toEqual({});
    });

    it('skips slots with no collectionId', () => {
      const doc = new Y.Doc();
      const valid = new Y.Map();
      valid.set('collectionId', 'coll-1');
      const invalid = new Y.Map();
      doc.getMap('blogSlotBindings').set('good', valid);
      doc.getMap('blogSlotBindings').set('bad', invalid);

      const all = readAllBlogSlotBindings(doc);
      expect(Object.keys(all).sort()).toEqual(['good']);
    });
  });

  describe('readResolvedStaticMarkup', () => {
    it('returns null when element is missing', () => {
      expect(readResolvedStaticMarkup(new Y.Doc(), 'ghost')).toBeNull();
    });

    it('returns the element markup when no overrides apply', () => {
      const doc = new Y.Doc();
      const el = new Y.Map();
      el.set('staticMarkup', '<h1>Hi</h1>');
      doc.getMap('elements').set('el-1', el);
      expect(readResolvedStaticMarkup(doc, 'el-1')).toContain('<h1');
    });
  });

  describe('readDrawnElementClasses', () => {
    it('returns "" when no sourceClasses entry exists', () => {
      expect(readDrawnElementClasses(new Y.Doc(), 'slot-1:posts')).toBe('');
    });

    it('returns "" when entry exists but classes field is absent', () => {
      const doc = new Y.Doc();
      doc.getMap('sourceClasses').set('slot-1', new Y.Map());
      expect(readDrawnElementClasses(doc, 'slot-1')).toBe('');
    });

    it('returns the classes string when present', () => {
      const doc = new Y.Doc();
      const entry = new Y.Map();
      entry.set('classes', 'grid grid-cols-3 gap-4');
      doc.getMap('sourceClasses').set('slot-1:posts', entry);
      expect(readDrawnElementClasses(doc, 'slot-1:posts')).toBe('grid grid-cols-3 gap-4');
    });
  });

  describe('Zod boundary parsing', () => {
    it('readBlogSlotBinding: reports drift and returns null on malformed settings', () => {
      const doc = new Y.Doc();
      const ySlot = new Y.Map();
      ySlot.set('collectionId', 'coll-1');
      const ySettings = new Y.Map();
      doc.getMap('blogSlotBindings').set('slot-1', ySlot);
      ySlot.set('settings', ySettings);
      ySettings.set('pagination', 'numberd'); // typo — not in enum

      const result = readBlogSlotBinding(doc, 'slot-1');
      expect(result).toBeNull();
      // `console.warn` in vitest (env.DEV is undefined) — see reportShapeDrift
      expect(consoleErrorSpy.mock.calls.length + consoleWarnSpy.mock.calls.length).toBeGreaterThan(0);
    });

    it('readBlogSlotBinding: reports drift on wrong postsPerPage type', () => {
      const doc = new Y.Doc();
      const ySlot = new Y.Map();
      ySlot.set('collectionId', 'coll-1');
      const ySettings = new Y.Map();
      doc.getMap('blogSlotBindings').set('slot-1', ySlot);
      ySlot.set('settings', ySettings);
      ySettings.set('postsPerPage', '9'); // string, not number

      const result = readBlogSlotBinding(doc, 'slot-1');
      expect(result).toBeNull();
    });

    it('readAllBlogSlotBindings: drops invalid entries, keeps valid ones', () => {
      const doc = new Y.Doc();

      const valid = new Y.Map();
      valid.set('collectionId', 'coll-1');
      doc.getMap('blogSlotBindings').set('good', valid);

      const invalid = new Y.Map();
      const badSettings = new Y.Map();
      doc.getMap('blogSlotBindings').set('bad', invalid);
      invalid.set('collectionId', 'coll-1');
      invalid.set('settings', badSettings);
      badSettings.set('pagination', 'nope');

      const all = readAllBlogSlotBindings(doc);
      expect(Object.keys(all)).toEqual(['good']);
    });
  });

  describe('readBlogSettingsFromYSlot', () => {
    it('returns DEFAULT_BLOG_SETTINGS for a slot with no settings child', () => {
      const ySlot = new Y.Map();
      expect(readBlogSettingsFromYSlot(ySlot)).toEqual(DEFAULT_BLOG_SETTINGS);
    });

    it('fills in defaults for individually missing fields', () => {
      // Y.Maps only integrate children once attached to a doc, so set the
      // partial settings through the doc-attached map.
      const doc = new Y.Doc();
      const ySlot = new Y.Map();
      const ySettings = new Y.Map();
      ySlot.set('settings', ySettings);
      doc.getMap('blogSlotBindings').set('slot-1', ySlot);
      ySettings.set('columns', 5);

      const result = readBlogSettingsFromYSlot(ySlot);
      expect(result.columns).toBe(5);
      expect(result.postsPerPage).toBe(DEFAULT_BLOG_SETTINGS.postsPerPage);
      expect(result.pagination).toBe(DEFAULT_BLOG_SETTINGS.pagination);
    });
  });
});
