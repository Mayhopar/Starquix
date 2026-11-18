/**
 * Slot Isolation Tests (Phase 5.10)
 *
 * These tests verify that changes to one CSS property slot
 * do not affect other slots. This addresses the bug where
 * changing font resets text color.
 */

import { describe, it, expect } from 'vitest';
import {
  parseClasses,
  serializeClasses,
  getEffectiveClasses,
  getPropertyGroup,
  cloneStorage,
  type Breakpoint,
  type Theme,
  type State,
  type ClassStorage,
} from '@/core/classes/index';

/**
 * Simulates the computeSlotContent logic from DesignBar.
 * This is a simplified version for testing.
 */
function computeSlotContent(
  storage: ClassStorage,
  breakpoint: Breakpoint,
  theme: Theme,
  state: State,
  newEffectiveClasses: string[]
): string[] {
  if (breakpoint === 'xs' && theme === 'light' && state === 'default') {
    return newEffectiveClasses;
  }

  const tempStorage = cloneStorage(storage);
  tempStorage[breakpoint][theme][state] = [];
  const inherited = getEffectiveClasses(tempStorage, breakpoint, theme, state);

  const inheritedByGroup = new Map<string, string>();
  inherited.forEach(cls => {
    inheritedByGroup.set(getPropertyGroup(cls), cls);
  });

  const toStore: string[] = [];
  newEffectiveClasses.forEach(cls => {
    const group = getPropertyGroup(cls);
    const inheritedCls = inheritedByGroup.get(group);
    if (inheritedCls !== cls) {
      toStore.push(cls);
    }
  });

  return toStore;
}

// ============================================================================
// 5.10.1-5.10.5: Slot Isolation Tests
// ============================================================================

describe('Slot Isolation - Property Group Categorization', () => {
  it('5.10.1: Font slot isolated from color slot - text-lg vs text-blue-500', () => {
    // Font sizes should be in standalone:textSize group
    expect(getPropertyGroup('text-xs')).toBe('standalone:textSize');
    expect(getPropertyGroup('text-sm')).toBe('standalone:textSize');
    expect(getPropertyGroup('text-base')).toBe('standalone:textSize');
    expect(getPropertyGroup('text-lg')).toBe('standalone:textSize');
    expect(getPropertyGroup('text-xl')).toBe('standalone:textSize');
    expect(getPropertyGroup('text-2xl')).toBe('standalone:textSize');
    expect(getPropertyGroup('text-9xl')).toBe('standalone:textSize');

    // Text colors should be in text- prefix group
    expect(getPropertyGroup('text-blue-500')).toBe('text-');
    expect(getPropertyGroup('text-red-500')).toBe('text-');
    expect(getPropertyGroup('text-gray-900')).toBe('text-');
    expect(getPropertyGroup('text-white')).toBe('text-');
    expect(getPropertyGroup('text-black')).toBe('text-');
    expect(getPropertyGroup('text-transparent')).toBe('text-');

    // They must be in different groups
    expect(getPropertyGroup('text-lg')).not.toBe(getPropertyGroup('text-blue-500'));
  });

  it('5.10.2: Color slot isolated from font slot - changing color preserves font', () => {
    const storage = parseClasses('text-lg text-blue-500');

    // Verify initial state
    expect(storage.xs.light.default).toContain('text-lg');
    expect(storage.xs.light.default).toContain('text-blue-500');

    // Simulate changing color to red
    const newStorage = cloneStorage(storage);
    // Remove old color, add new color
    newStorage.xs.light.default = newStorage.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'text-')
      .concat(['text-red-500']);

    // Font should still be there
    expect(newStorage.xs.light.default).toContain('text-lg');
    expect(newStorage.xs.light.default).toContain('text-red-500');
    expect(newStorage.xs.light.default).not.toContain('text-blue-500');
  });

  it('5.10.3: Size slot isolated from spacing slot', () => {
    // Width classes
    expect(getPropertyGroup('w-full')).toBe('w-');
    expect(getPropertyGroup('w-1/2')).toBe('w-');
    expect(getPropertyGroup('w-64')).toBe('w-');

    // Height classes
    expect(getPropertyGroup('h-screen')).toBe('h-');
    expect(getPropertyGroup('h-full')).toBe('h-');

    // Padding classes
    expect(getPropertyGroup('p-4')).toBe('p-');
    expect(getPropertyGroup('px-6')).toBe('px-');
    expect(getPropertyGroup('py-8')).toBe('py-');

    // Margin classes
    expect(getPropertyGroup('m-4')).toBe('m-');
    expect(getPropertyGroup('mx-auto')).toBe('mx-');

    // All different groups
    expect(getPropertyGroup('w-full')).not.toBe(getPropertyGroup('p-4'));
    expect(getPropertyGroup('h-screen')).not.toBe(getPropertyGroup('m-4'));
  });

  it('5.10.4: Layout slot isolated from effects slot', () => {
    // Layout classes
    expect(getPropertyGroup('flex')).toBe('standalone:display');
    expect(getPropertyGroup('grid')).toBe('standalone:display');
    expect(getPropertyGroup('block')).toBe('standalone:display');
    expect(getPropertyGroup('hidden')).toBe('standalone:display');

    // Flex direction
    expect(getPropertyGroup('flex-row')).toBe('standalone:flexDirection');
    expect(getPropertyGroup('flex-col')).toBe('standalone:flexDirection');

    // Effects classes
    expect(getPropertyGroup('shadow-sm')).toBe('shadow-');
    expect(getPropertyGroup('shadow-lg')).toBe('shadow-');
    expect(getPropertyGroup('opacity-50')).toBe('opacity-');

    // Different groups
    expect(getPropertyGroup('flex')).not.toBe(getPropertyGroup('shadow-sm'));
    expect(getPropertyGroup('grid')).not.toBe(getPropertyGroup('opacity-50'));
  });

  it('5.10.5: Border slot isolated from fill slot', () => {
    // Border classes
    expect(getPropertyGroup('border')).toBe('standalone:borderWidth');
    expect(getPropertyGroup('border-2')).toBe('standalone:borderWidth');
    expect(getPropertyGroup('border-red-500')).toBe('border-');
    expect(getPropertyGroup('rounded-lg')).toBe('rounded-');

    // Fill/background classes
    expect(getPropertyGroup('bg-white')).toBe('bg-');
    expect(getPropertyGroup('bg-blue-500')).toBe('bg-');
    expect(getPropertyGroup('bg-gradient-to-r')).toBe('bg-');

    // Different groups
    expect(getPropertyGroup('border-red-500')).not.toBe(getPropertyGroup('bg-blue-500'));
    expect(getPropertyGroup('border')).not.toBe(getPropertyGroup('bg-white'));
  });
});

// ============================================================================
// 5.10.6-5.10.7: Sequential Change Tests
// ============================================================================

describe('Slot Isolation - Sequential Changes', () => {
  it('5.10.6: Change property A, change property B, verify A unchanged', () => {
    // Start with text-lg and text-blue-500
    let storage = parseClasses('text-lg text-blue-500');

    // Step 1: Change font size to text-xl
    const newStorage1 = cloneStorage(storage);
    newStorage1.xs.light.default = newStorage1.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:textSize')
      .concat(['text-xl']);

    expect(newStorage1.xs.light.default).toContain('text-xl');
    expect(newStorage1.xs.light.default).toContain('text-blue-500');

    // Step 2: Change text color to text-red-500
    const newStorage2 = cloneStorage(newStorage1);
    newStorage2.xs.light.default = newStorage2.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'text-')
      .concat(['text-red-500']);

    // Verify font size is still text-xl (not reset)
    expect(newStorage2.xs.light.default).toContain('text-xl');
    expect(newStorage2.xs.light.default).toContain('text-red-500');
    expect(newStorage2.xs.light.default).not.toContain('text-lg');
    expect(newStorage2.xs.light.default).not.toContain('text-blue-500');
  });

  it('5.10.7: Change property B, change property A, verify B unchanged', () => {
    // Start with bg-white and p-4
    let storage = parseClasses('bg-white p-4');

    // Step 1: Change background to bg-blue-500
    const newStorage1 = cloneStorage(storage);
    newStorage1.xs.light.default = newStorage1.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'bg-')
      .concat(['bg-blue-500']);

    expect(newStorage1.xs.light.default).toContain('bg-blue-500');
    expect(newStorage1.xs.light.default).toContain('p-4');

    // Step 2: Change padding to p-8
    const newStorage2 = cloneStorage(newStorage1);
    newStorage2.xs.light.default = newStorage2.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'p-')
      .concat(['p-8']);

    // Verify background is still bg-blue-500 (not reset)
    expect(newStorage2.xs.light.default).toContain('bg-blue-500');
    expect(newStorage2.xs.light.default).toContain('p-8');
    expect(newStorage2.xs.light.default).not.toContain('bg-white');
    expect(newStorage2.xs.light.default).not.toContain('p-4');
  });
});

// ============================================================================
// 5.10.8-5.10.9: Rapid Sequential Changes
// ============================================================================

describe('Slot Isolation - Rapid Sequential Changes', () => {
  it('5.10.8: Rapid sequential changes to different slots', () => {
    let storage = parseClasses('flex p-4 text-lg bg-white');

    // Rapid changes to different properties
    const changes = [
      { group: 'standalone:display', newClass: 'grid' },
      { group: 'p-', newClass: 'p-8' },
      { group: 'standalone:textSize', newClass: 'text-2xl' },
      { group: 'bg-', newClass: 'bg-gray-100' },
    ];

    for (const change of changes) {
      const newStorage = cloneStorage(storage);
      newStorage.xs.light.default = newStorage.xs.light.default
        .filter(cls => getPropertyGroup(cls) !== change.group)
        .concat([change.newClass]);
      storage = newStorage;
    }

    // All final values should be present
    expect(storage.xs.light.default).toContain('grid');
    expect(storage.xs.light.default).toContain('p-8');
    expect(storage.xs.light.default).toContain('text-2xl');
    expect(storage.xs.light.default).toContain('bg-gray-100');

    // Original values should be gone
    expect(storage.xs.light.default).not.toContain('flex');
    expect(storage.xs.light.default).not.toContain('p-4');
    expect(storage.xs.light.default).not.toContain('text-lg');
    expect(storage.xs.light.default).not.toContain('bg-white');
  });

  it('5.10.9: 10 sequential changes to different properties', () => {
    let storage = parseClasses('flex flex-row justify-start items-start p-4 m-0 w-auto h-auto bg-white text-black');

    const changes = [
      { group: 'standalone:display', newClass: 'grid' },
      { group: 'standalone:flexDirection', newClass: 'flex-col' },
      { group: 'justify-', newClass: 'justify-center' },
      { group: 'items-', newClass: 'items-center' },
      { group: 'p-', newClass: 'p-8' },
      { group: 'm-', newClass: 'm-4' },
      { group: 'w-', newClass: 'w-full' },
      { group: 'h-', newClass: 'h-screen' },
      { group: 'bg-', newClass: 'bg-blue-500' },
      { group: 'text-', newClass: 'text-white' },
    ];

    for (const change of changes) {
      const newStorage = cloneStorage(storage);
      newStorage.xs.light.default = newStorage.xs.light.default
        .filter(cls => getPropertyGroup(cls) !== change.group)
        .concat([change.newClass]);
      storage = newStorage;
    }

    // All 10 final values should be present
    expect(storage.xs.light.default).toContain('grid');
    expect(storage.xs.light.default).toContain('flex-col');
    expect(storage.xs.light.default).toContain('justify-center');
    expect(storage.xs.light.default).toContain('items-center');
    expect(storage.xs.light.default).toContain('p-8');
    expect(storage.xs.light.default).toContain('m-4');
    expect(storage.xs.light.default).toContain('w-full');
    expect(storage.xs.light.default).toContain('h-screen');
    expect(storage.xs.light.default).toContain('bg-blue-500');
    expect(storage.xs.light.default).toContain('text-white');
  });
});

// ============================================================================
// 5.10.10: Undo Interaction
// ============================================================================

describe('Slot Isolation - Undo Interaction', () => {
  it('5.10.10: Change, undo, change different property', () => {
    // Start state
    const initialClasses = 'text-lg text-blue-500';
    let storage = parseClasses(initialClasses);

    // Save snapshot for undo
    const snapshot = serializeClasses(storage);

    // Change 1: font size to text-xl
    const newStorage1 = cloneStorage(storage);
    newStorage1.xs.light.default = newStorage1.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:textSize')
      .concat(['text-xl']);
    storage = newStorage1;

    expect(storage.xs.light.default).toContain('text-xl');
    expect(storage.xs.light.default).toContain('text-blue-500');

    // Undo - restore from snapshot
    storage = parseClasses(snapshot);

    expect(storage.xs.light.default).toContain('text-lg');
    expect(storage.xs.light.default).toContain('text-blue-500');

    // Change 2: different property (color)
    const newStorage2 = cloneStorage(storage);
    newStorage2.xs.light.default = newStorage2.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'text-')
      .concat(['text-red-500']);
    storage = newStorage2;

    // Font should still be text-lg (original), color should be new
    expect(storage.xs.light.default).toContain('text-lg');
    expect(storage.xs.light.default).toContain('text-red-500');
    expect(storage.xs.light.default).not.toContain('text-blue-500');
  });
});

// ============================================================================
// 5.10.12: computeSlotContent Tests
// ============================================================================

describe('Slot Isolation - computeSlotContent', () => {
  it('5.10.12: computeSlotContent only modifies target slot classes', () => {
    const storage = parseClasses('text-lg text-blue-500 p-4 bg-white');

    // Simulate changing just font size
    const newEffective = ['text-2xl', 'text-blue-500', 'p-4', 'bg-white'];
    const slotContent = computeSlotContent(storage, 'xs', 'light', 'default', newEffective);

    // For base slot, all effective classes are stored
    expect(slotContent).toContain('text-2xl');
    expect(slotContent).toContain('text-blue-500');
    expect(slotContent).toContain('p-4');
    expect(slotContent).toContain('bg-white');
    expect(slotContent).not.toContain('text-lg');
  });

  it('5.10.12: computeSlotContent preserves classes in non-base slots via inheritance', () => {
    // Setup: base has text-lg, text-blue-500
    const storage = parseClasses('text-lg text-blue-500');

    // At md breakpoint, only store what differs from inherited
    // If we want to change font to text-2xl at md, but keep color inherited
    const newEffective = ['text-2xl', 'text-blue-500'];
    const slotContent = computeSlotContent(storage, 'md', 'light', 'default', newEffective);

    // Only text-2xl should be stored (differs from inherited text-lg)
    // text-blue-500 is same as inherited, so not stored
    expect(slotContent).toContain('text-2xl');
    expect(slotContent).not.toContain('text-blue-500'); // Inherited, not stored
    expect(slotContent).not.toContain('text-lg');
  });

  it('5.10.12: computeSlotContent for hover state only stores differences', () => {
    // Setup: base has text-blue-500
    const storage = parseClasses('text-blue-500');

    // At hover state, only store what differs
    const newEffective = ['text-red-500'];
    const slotContent = computeSlotContent(storage, 'xs', 'light', 'hover', newEffective);

    // Only text-red-500 should be stored (differs from inherited text-blue-500)
    expect(slotContent).toContain('text-red-500');
    expect(slotContent).not.toContain('text-blue-500');
  });
});

// ============================================================================
// Font Family vs Font Weight Isolation
// ============================================================================

describe('Slot Isolation - Font Family vs Font Weight', () => {
  it('should categorize font-family and font-weight into separate groups', () => {
    // Font family classes
    expect(getPropertyGroup('font-sans')).toBe('standalone:fontFamily');
    expect(getPropertyGroup('font-serif')).toBe('standalone:fontFamily');
    expect(getPropertyGroup('font-mono')).toBe('standalone:fontFamily');

    // Font weight classes
    expect(getPropertyGroup('font-thin')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-extralight')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-light')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-normal')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-medium')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-semibold')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-bold')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-extrabold')).toBe('standalone:fontWeight');
    expect(getPropertyGroup('font-black')).toBe('standalone:fontWeight');

    // They must be in different groups
    expect(getPropertyGroup('font-sans')).not.toBe(getPropertyGroup('font-bold'));
    expect(getPropertyGroup('font-serif')).not.toBe(getPropertyGroup('font-normal'));
  });

  it('font-["Inter"] classifies as standalone:fontFamily, not fontWeight (task-112)', () => {
    expect(getPropertyGroup('font-["Inter"]')).toBe('standalone:fontFamily');
    expect(getPropertyGroup('font-["Open_Sans"]')).toBe('standalone:fontFamily');
    expect(getPropertyGroup('font-[family-name:var(--heading)]')).toBe('standalone:fontFamily');
    expect(getPropertyGroup('font-bold')).toBe('standalone:fontWeight'); // untouched
  });

  it('setting font-["Inter"] replaces font-sans but keeps font-bold', () => {
    const storage = parseClasses('font-sans font-bold');
    const newStorage = cloneStorage(storage);
    newStorage.xs.light.default = newStorage.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontFamily')
      .concat(['font-["Inter"]']);

    expect(newStorage.xs.light.default).toContain('font-["Inter"]');
    expect(newStorage.xs.light.default).toContain('font-bold');
    expect(newStorage.xs.light.default).not.toContain('font-sans');
  });

  it('should preserve font-weight when changing font-family', () => {
    let storage = parseClasses('font-sans font-bold');

    // Change font family to serif
    const newStorage = cloneStorage(storage);
    newStorage.xs.light.default = newStorage.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontFamily')
      .concat(['font-serif']);

    // Font weight must be preserved
    expect(newStorage.xs.light.default).toContain('font-serif');
    expect(newStorage.xs.light.default).toContain('font-bold');
    expect(newStorage.xs.light.default).not.toContain('font-sans');
  });

  it('should preserve font-family when changing font-weight', () => {
    let storage = parseClasses('font-mono font-normal');

    // Change font weight to bold
    const newStorage = cloneStorage(storage);
    newStorage.xs.light.default = newStorage.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontWeight')
      .concat(['font-bold']);

    // Font family must be preserved
    expect(newStorage.xs.light.default).toContain('font-mono');
    expect(newStorage.xs.light.default).toContain('font-bold');
    expect(newStorage.xs.light.default).not.toContain('font-normal');
  });
});

// ============================================================================
// Exact User Bug: Font Family Change Loses Text Color
// ============================================================================

describe('Slot Isolation - User Bug: Font Family Change Loses Color', () => {
  it('should preserve text color when changing font family via property group isolation', () => {
    // User's exact scenario:
    // Initial: text-stone-800 font-sans text-3xl font-bold ...
    // After font family change: text color (text-stone-800) was lost

    const storage = parseClasses('text-stone-800 font-sans text-3xl font-bold leading-tight');

    // Change font family from sans to serif
    const newStorage = cloneStorage(storage);
    newStorage.xs.light.default = newStorage.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontFamily')
      .concat(['font-serif']);

    // CRITICAL: text color must be preserved
    expect(newStorage.xs.light.default).toContain('text-stone-800');
    // Font family changed
    expect(newStorage.xs.light.default).toContain('font-serif');
    expect(newStorage.xs.light.default).not.toContain('font-sans');
    // Other properties preserved
    expect(newStorage.xs.light.default).toContain('text-3xl');
    expect(newStorage.xs.light.default).toContain('font-bold');
    expect(newStorage.xs.light.default).toContain('leading-tight');
  });

  it('should handle full user scenario: color change then font family change', () => {
    // User's exact sequence:
    // 1. Start: text-stone-800 font-sans text-3xl font-bold ...
    // 2. Change color to red-600
    // 3. Change font family to serif
    // Bug: Step 3 caused color to be lost

    let storage = parseClasses('text-stone-800 font-sans text-3xl font-bold leading-tight');

    // Step 1: Change text color to red-600
    storage.xs.light.default = storage.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'text-')
      .concat(['text-red-600']);

    expect(storage.xs.light.default).toContain('text-red-600');
    expect(storage.xs.light.default).not.toContain('text-stone-800');
    expect(storage.xs.light.default).toContain('font-sans');
    expect(storage.xs.light.default).toContain('text-3xl');

    // Step 2: Change font family to serif
    storage.xs.light.default = storage.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontFamily')
      .concat(['font-serif']);

    // CRITICAL: text-red-600 must still be present
    expect(storage.xs.light.default).toContain('text-red-600');
    expect(storage.xs.light.default).toContain('font-serif');
    expect(storage.xs.light.default).not.toContain('font-sans');
    // Other properties preserved
    expect(storage.xs.light.default).toContain('text-3xl');
    expect(storage.xs.light.default).toContain('font-bold');
    expect(storage.xs.light.default).toContain('leading-tight');
  });

  it('should not confuse font-family, font-weight, font-style groups', () => {
    // All three use 'font-' prefix but should be isolated
    const storage = parseClasses('font-serif font-bold italic');

    // Change font family
    const afterFamily = cloneStorage(storage);
    afterFamily.xs.light.default = afterFamily.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontFamily')
      .concat(['font-mono']);

    expect(afterFamily.xs.light.default).toContain('font-mono');
    expect(afterFamily.xs.light.default).toContain('font-bold');
    expect(afterFamily.xs.light.default).toContain('italic');

    // Change font weight
    const afterWeight = cloneStorage(afterFamily);
    afterWeight.xs.light.default = afterWeight.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontWeight')
      .concat(['font-normal']);

    expect(afterWeight.xs.light.default).toContain('font-mono');
    expect(afterWeight.xs.light.default).toContain('font-normal');
    expect(afterWeight.xs.light.default).not.toContain('font-bold');
    expect(afterWeight.xs.light.default).toContain('italic');

    // Change font style
    const afterStyle = cloneStorage(afterWeight);
    afterStyle.xs.light.default = afterStyle.xs.light.default
      .filter(cls => getPropertyGroup(cls) !== 'standalone:fontStyle')
      .concat(['not-italic']);

    expect(afterStyle.xs.light.default).toContain('font-mono');
    expect(afterStyle.xs.light.default).toContain('font-normal');
    expect(afterStyle.xs.light.default).toContain('not-italic');
    expect(afterStyle.xs.light.default).not.toContain('italic');
  });
});
