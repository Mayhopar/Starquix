import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { rebuildMasters, serializeMasters, selectMasterMarkup, selectMasterChildOverrides } from '@/store/masters';

const SLOT_PATH = 'src/components/library/BlogSlot.astro';
const CARD_PATH = 'src/components/library/BlogCard.astro';

const CARD_BASE = '<div class="bg-stone-200 rounded"><h3>{title}</h3></div>';
const INLINED_SLOT =
  `<section class="bg-stone-100"><slot name="posts"><div data-sq-component-src="${CARD_PATH}" class="bg-rose-500 rounded"><h3>{title}</h3></div></slot></section>`;

describe('rebuildMasters migration: collapse legacy inlined children', () => {
  it('collapses inlined marker HTML to sq-child + extracts root-class patch from sibling masters entry', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = new Y.Doc();
    rebuildMasters(doc, {
      [SLOT_PATH]: { markup: INLINED_SLOT },
      [CARD_PATH]: { markup: CARD_BASE },
    });
    const migrated = selectMasterMarkup(doc, SLOT_PATH)!;
    expect(migrated).toContain('<sq-child');
    expect(migrated).toContain(`data-sq-astro-source="${CARD_PATH}"`);
    expect(migrated).toContain('data-sq-placement="posts"');
    expect(migrated).not.toContain('data-sq-component-src');
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'div-0': { base: ['bg-rose-500', 'rounded'] } } });
    // Child entry untouched.
    expect(selectMasterMarkup(doc, CARD_PATH)).toBe(CARD_BASE);
    warn.mockRestore();
  });

  it('existing childOverrides keys win over migration patches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = new Y.Doc();
    rebuildMasters(doc, {
      [SLOT_PATH]: { markup: INLINED_SLOT, childOverrides: { posts: { 'div-0': { base: ['bg-white'] } } } },
      [CARD_PATH]: { markup: CARD_BASE },
    });
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'div-0': { base: ['bg-white'] } } });
    warn.mockRestore();
  });

  it('already-collapsed entry (sq-child, no marker) is untouched byte-for-byte', () => {
    const collapsed = `<section><sq-child data-sq-astro-source="${CARD_PATH}" data-sq-placement="posts"></sq-child></section>`;
    const doc = new Y.Doc();
    rebuildMasters(doc, { [SLOT_PATH]: { markup: collapsed } });
    expect(selectMasterMarkup(doc, SLOT_PATH)).toBe(collapsed);
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({});
  });

  it('resets inlined pagination HTML back to the empty settings-driven slot', () => {
    // Regression: an old-era bake captured pagination markup INLINE in the
    // BlogSlot master — it rendered unconditionally (pagination visible with
    // the setting off) until the selection-mounted reconcile removed it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dirty = '<section><div data-blog-source="pagination" class="mt-4"><nav class="flex">Previous 1 2 3 Next</nav></div></section>';
    const doc = new Y.Doc();
    rebuildMasters(doc, { [SLOT_PATH]: { markup: dirty } });
    const migrated = selectMasterMarkup(doc, SLOT_PATH)!;
    expect(migrated).toContain('<slot name="pagination"></slot>');
    expect(migrated).not.toContain('Previous');
    expect(migrated).toContain('data-blog-source="pagination"'); // wrapper survives
    warn.mockRestore();
  });

  it('markup whose pagination wrapper already holds just the slot is untouched byte-for-byte', () => {
    const clean = '<section><div data-blog-source="pagination"><slot name="pagination"></slot></div></section>';
    const doc = new Y.Doc();
    rebuildMasters(doc, { [SLOT_PATH]: { markup: clean } });
    expect(selectMasterMarkup(doc, SLOT_PATH)).toBe(clean);
  });

  it('idempotent: serialize → rebuild twice → same result', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = new Y.Doc();
    rebuildMasters(doc, {
      [SLOT_PATH]: { markup: INLINED_SLOT },
      [CARD_PATH]: { markup: CARD_BASE },
    });
    const once = serializeMasters(doc)!;
    const doc2 = new Y.Doc();
    rebuildMasters(doc2, once);
    expect(serializeMasters(doc2)).toEqual(once);
    warn.mockRestore();
  });
});
