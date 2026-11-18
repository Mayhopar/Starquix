/**
 * task-102 — UPDATE_BLOG_SLOT_SETTINGS under the sparse-inheritance model:
 * master writes bump settingsRev; instance writes store ONLY the patched
 * fields (no default fill) and stamp settingsBaseRev = current master rev.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { BLOG_SLOT_DEFAULTS_KEY } from '@/core/collections/types';
import {
  readBlogSettingsRaw,
  readMasterSettingsRev,
  readInstanceSettingsBaseRev,
} from '@/core/collections/yjsAccessors';

describe('UPDATE_BLOG_SLOT_SETTINGS — sparse writes + rev stamps (task-102)', () => {
  it('master write bumps settingsRev', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: BLOG_SLOT_DEFAULTS_KEY, settings: { postsPerPage: 6 } });
    expect(readMasterSettingsRev(doc)).toBe(1);
    applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: BLOG_SLOT_DEFAULTS_KEY, settings: { pagination: 'none' } });
    expect(readMasterSettingsRev(doc)).toBe(2);
  });

  it('instance write stores ONLY the patched field and stamps settingsBaseRev', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: BLOG_SLOT_DEFAULTS_KEY, settings: { postsPerPage: 6 } }); // rev=1
    applyCommand(doc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: 'slot-1', settings: { pagination: 'none' } });
    expect(readBlogSettingsRaw(doc, 'slot-1')).toEqual({ pagination: 'none' }); // sparse!
    expect(readInstanceSettingsBaseRev(doc, 'slot-1')).toBe(1);
  });
});
