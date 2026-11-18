import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { selectMasterChildOverrides, selectMasterMarkup } from '@/store/masters';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { createDebouncedBake } from '@/utils/editorAutoBake';

const SLOT_PATH = 'src/components/library/BlogSlot.astro';
const CARD_PATH = 'src/components/library/BlogCard.astro';

function seedEditor(doc: Y.Doc) {
  const editor = new Y.Map<unknown>();
  editor.set('id', 'ed-1');
  editor.set('pageId', COMPONENT_EDITOR_PAGE_ID);
  editor.set('astroSource', SLOT_PATH);
  editor.set('staticMarkup', '<section><slot name="posts"></slot></section>');
  doc.getMap('elements').set('ed-1', editor);

  const card = new Y.Map<unknown>();
  card.set('id', 'card-1');
  card.set('pageId', COMPONENT_EDITOR_PAGE_ID);
  card.set('parentId', 'ed-1');
  card.set('slotName', 'posts');
  card.set('placementKey', 'posts');
  card.set('astroSource', CARD_PATH);
  card.set('staticMarkup', '<div class="bg-stone-200">t</div>');
  card.set('classOverrides', new Y.Map());
  doc.getMap('elements').set('card-1', card);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createDebouncedBake — reload-safe editor persistence (task-098 bug)', () => {
  it('bakes childOverrides after the debounce window without any leave handler', () => {
    const doc = new Y.Doc();
    seedEditor(doc);
    const bake = createDebouncedBake(doc, () => 'ed-1', 800);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'card-1', selector: 'div-0', breakpoint: 'base', classes: ['bg-white'],
    });
    bake.schedule();
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({}); // not yet
    vi.advanceTimersByTime(800);
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'div-0': { base: ['bg-white'] } } });
    expect(selectMasterMarkup(doc, SLOT_PATH)).toBeDefined();
    bake.dispose();
  });

  it('flushNow bakes a pending edit immediately (pagehide path)', () => {
    const doc = new Y.Doc();
    seedEditor(doc);
    const bake = createDebouncedBake(doc, () => 'ed-1', 800);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'card-1', selector: 'div-0', breakpoint: 'base', classes: ['bg-white'],
    });
    bake.schedule();
    bake.flushNow();
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'div-0': { base: ['bg-white'] } } });
    bake.dispose();
  });

  it('flushNow with nothing pending does not touch masters', () => {
    const doc = new Y.Doc();
    seedEditor(doc);
    const bake = createDebouncedBake(doc, () => 'ed-1', 800);
    bake.flushNow();
    expect(selectMasterMarkup(doc, SLOT_PATH)).toBeUndefined();
    bake.dispose();
  });

  it('dispose cancels a pending bake', () => {
    const doc = new Y.Doc();
    seedEditor(doc);
    const bake = createDebouncedBake(doc, () => 'ed-1', 800);
    bake.schedule();
    bake.dispose();
    vi.advanceTimersByTime(2000);
    expect(selectMasterMarkup(doc, SLOT_PATH)).toBeUndefined();
  });

  it('resolves the editor element id AT FIRE TIME, not at creation (re-seed race)', () => {
    // Regression: the effect captured the element id once; the async editor
    // re-seed then replaced the element, leaving auto-bake bound to a DEAD id —
    // bakeEditorMaster no-oped silently and every edit was session-only.
    const doc = new Y.Doc();
    seedEditor(doc);
    let currentId: string | null = 'el-STALE-DEAD';
    const bake = createDebouncedBake(doc, () => currentId, 800);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'card-1', selector: 'div-0', breakpoint: 'base', classes: ['bg-orange-500'],
    });
    bake.schedule();
    currentId = 'ed-1'; // seed completed AFTER the effect bound the getter
    vi.advanceTimersByTime(800);
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'div-0': { base: ['bg-orange-500'] } } });
  });
});
