import { describe, it, expect } from 'vitest';
import { goToSourceNameFor } from '@/components/DesignBar/utils';

/**
 * Regression: in the BlogSlot master editor, isBlogSlot is true for EVERY
 * selection (editorBlogSlotKey), so the card's ↗ carried name='BlogSlot' —
 * and the LeftSidebar handler's name-over-path priority (legacy drawn-slot
 * hack) reopened BlogSlot instead of BlogCard, forever.
 */
describe('goToSourceNameFor', () => {
  const base = {
    isPostRoot: false,
    postRootComponentName: 'BlogCard',
    isEditorChildInstance: false,
    isBlogSlot: false,
    blogSlotComponentType: 'BlogSlot',
  };

  it('editor CHILD instance gets NO name override — its astroSource is authoritative', () => {
    expect(goToSourceNameFor({ ...base, isEditorChildInstance: true, isBlogSlot: true })).toBeUndefined();
  });

  it('canvas post root resolves to the card component name', () => {
    expect(goToSourceNameFor({ ...base, isPostRoot: true, isBlogSlot: true })).toBe('BlogCard');
  });

  it('the slot itself keeps the legacy BlogSlot override', () => {
    expect(goToSourceNameFor({ ...base, isBlogSlot: true })).toBe('BlogSlot');
  });

  it('plain instances get no override', () => {
    expect(goToSourceNameFor(base)).toBeUndefined();
  });
});
