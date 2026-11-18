import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  resolveBlogSettings, readMasterSettingsRev, readInstanceSettingsBaseRev,
  readBlogSlotBinding,
} from '@/core/collections/yjsAccessors';
import { BLOG_SLOT_DEFAULTS_KEY, DEFAULT_BLOG_SETTINGS } from '@/core/collections/types';

function setBinding(doc: Y.Doc, key: string, settings: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const ySlot = new Y.Map<unknown>();
  const ySettings = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(settings)) ySettings.set(k, v);
  ySlot.set('settings', ySettings);
  for (const [k, v] of Object.entries(extra)) ySlot.set(k, v);
  doc.getMap('blogSlotBindings').set(key, ySlot);
}

describe('resolveBlogSettings — instance → master → app default, per field', () => {
  it('no bindings at all → app defaults', () => {
    const doc = new Y.Doc();
    expect(resolveBlogSettings(doc, 'slot-1')).toEqual(DEFAULT_BLOG_SETTINGS);
  });

  it('master default fills a field the instance never set', () => {
    const doc = new Y.Doc();
    setBinding(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 6 });
    setBinding(doc, 'slot-1', {});
    expect(resolveBlogSettings(doc, 'slot-1').postsPerPage).toBe(6);
    expect(resolveBlogSettings(doc, 'slot-1').pagination).toBe(DEFAULT_BLOG_SETTINGS.pagination);
  });

  it('instance override wins over master, other fields still inherit', () => {
    const doc = new Y.Doc();
    setBinding(doc, BLOG_SLOT_DEFAULTS_KEY, { postsPerPage: 6, pagination: 'numbered' });
    setBinding(doc, 'slot-1', { pagination: 'none' });
    const r = resolveBlogSettings(doc, 'slot-1');
    expect(r.pagination).toBe('none');   // override
    expect(r.postsPerPage).toBe(6);      // live from master
  });

  it('the defaults key resolves master → app default (never itself an instance)', () => {
    const doc = new Y.Doc();
    setBinding(doc, BLOG_SLOT_DEFAULTS_KEY, { sortBy: 'date-asc' });
    expect(resolveBlogSettings(doc, BLOG_SLOT_DEFAULTS_KEY).sortBy).toBe('date-asc');
  });
});

describe('settings revision accessors', () => {
  it('missing revs read as 0', () => {
    const doc = new Y.Doc();
    expect(readMasterSettingsRev(doc)).toBe(0);
    expect(readInstanceSettingsBaseRev(doc, 'slot-1')).toBe(0);
  });
  it('reads stored revs', () => {
    const doc = new Y.Doc();
    setBinding(doc, BLOG_SLOT_DEFAULTS_KEY, {}, { settingsRev: 3 });
    setBinding(doc, 'slot-1', {}, { settingsBaseRev: 2 });
    expect(readMasterSettingsRev(doc)).toBe(3);
    expect(readInstanceSettingsBaseRev(doc, 'slot-1')).toBe(2);
  });
});

describe('binding schema tolerates the rev fields (task-102)', () => {
  it('readBlogSlotBinding parses a binding carrying settingsRev/settingsBaseRev', () => {
    const doc = new Y.Doc();
    setBinding(doc, 'slot-1', { pagination: 'none' }, { collectionId: 'col-1', bindings: undefined, settingsBaseRev: 2 });
    const ySlot = doc.getMap('blogSlotBindings').get('slot-1') as Y.Map<unknown>;
    ySlot.set('bindings', new Y.Map());
    expect(readBlogSlotBinding(doc, 'slot-1')).not.toBeNull();
  });
});
