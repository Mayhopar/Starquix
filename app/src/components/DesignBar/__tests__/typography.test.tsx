/**
 * Typography Block Tests (Phase 5.4)
 *
 * Tests for all typography controls in the DesignBar.
 * Includes critical tests for slot isolation (5.4.8-5.4.13)
 * to verify font changes preserve text color.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import {
  parseClasses,
  serializeClasses,
  getEffectiveClasses,
  getPropertyGroup,
  cloneStorage,
  type ClassStorage,
} from '@/core/classes/index';
import { findClass, setClass, removeClasses } from '../utils';

// ============================================================================
// Test Helpers
// ============================================================================

type BreakpointKey = 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

function makeClasses(overrides: Partial<Record<BreakpointKey, string[]>>): Record<BreakpointKey, string[]> {
  return {
    base: [],
    sm: [],
    md: [],
    lg: [],
    xl: [],
    '2xl': [],
    ...overrides,
  };
}

function setupElementWithClasses(classes: Record<BreakpointKey, string[]>): {
  doc: Y.Doc;
  getClasses: (breakpoint: BreakpointKey) => string[];
} {
  const doc = createEditorDoc();

  applyCommand(doc, {
    type: 'ADD_PAGE',
    page: { id: 'page-1', name: 'Test', rootElementIds: [], children: [] },
  });

  applyCommand(doc, {
    type: 'ADD_ELEMENT',
    element: {
      id: 'elem-1',
      pageId: 'page-1',
      parentId: null,
      index: 0,
      type: 'frame',
      classes,
    },
  });

  const elements = doc.getMap('elements');

  function getClasses(breakpoint: BreakpointKey): string[] {
    const element = elements.get('elem-1') as Y.Map<unknown>;
    const classMap = element.get('classes') as Y.Map<Y.Array<string>>;
    return (classMap.get(breakpoint) as Y.Array<string>).toArray();
  }

  return { doc, getClasses };
}

// Helper to simulate TypographyBlock's handleFontFamilyChange
function changeFontFamily(classes: string, value: string): string {
  let newClasses = setClass(classes, /^font-(sans|serif|mono)$/, null);
  if (value) {
    newClasses = newClasses + ` font-${value}`;
  }
  return newClasses.trim();
}

// Helper to simulate TypographyBlock's handleFontSizeChange
function changeFontSize(classes: string, value: string): string {
  let newClasses = setClass(classes, /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\[.+\])$/, null);
  if (value) {
    newClasses = newClasses + ` text-${value}`;
  }
  return newClasses.trim();
}

// Helper to simulate TypographyBlock's handleFontWeightChange
function changeFontWeight(classes: string, value: string): string {
  let newClasses = setClass(classes, /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/, null);
  if (value && value !== 'normal') {
    newClasses = newClasses + ` font-${value}`;
  }
  return newClasses.trim();
}

// Helper to simulate TypographyBlock's handleTextColorChange
function changeTextColor(classes: string, colorClass: string): string {
  let newClasses = setClass(classes, /^text-(transparent|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d+)?$/, null);
  newClasses = setClass(newClasses, /^text-\[#[0-9a-fA-F]+\]$/, null);
  if (colorClass) {
    newClasses = newClasses + ` ${colorClass}`;
  }
  return newClasses.trim();
}

// ============================================================================
// 5.4.1 - Font Family Tests
// ============================================================================

describe('5.4.1: Font family - sans/serif/mono', () => {
  it('should set font-sans', () => {
    const result = changeFontFamily('', 'sans');
    expect(result).toBe('font-sans');
  });

  it('should set font-serif', () => {
    const result = changeFontFamily('', 'serif');
    expect(result).toBe('font-serif');
  });

  it('should set font-mono', () => {
    const result = changeFontFamily('', 'mono');
    expect(result).toBe('font-mono');
  });

  it('should replace existing font family', () => {
    const result = changeFontFamily('font-sans text-lg', 'serif');
    expect(result).toBe('text-lg font-serif');
    expect(result).not.toContain('font-sans');
  });

  it('should clear font family when empty', () => {
    const result = changeFontFamily('font-sans text-lg', '');
    expect(result).toBe('text-lg');
  });
});

// ============================================================================
// 5.4.2 - Font Size Tests
// ============================================================================

describe('5.4.2: Font size - all scale values (xs-9xl)', () => {
  const fontSizes = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];

  fontSizes.forEach(size => {
    it(`should set text-${size}`, () => {
      const result = changeFontSize('', size);
      expect(result).toBe(`text-${size}`);
    });
  });

  it('should replace existing font size', () => {
    const result = changeFontSize('text-sm p-4', 'xl');
    expect(result).toBe('p-4 text-xl');
    expect(result).not.toContain('text-sm');
  });

  it('should handle arbitrary values', () => {
    const result = changeFontSize('', '[18px]');
    expect(result).toBe('text-[18px]');
  });
});

// ============================================================================
// 5.4.3 - Font Weight Tests
// ============================================================================

describe('5.4.3: Font weight - 100-900', () => {
  const fontWeights = ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'];

  fontWeights.filter(w => w !== 'normal').forEach(weight => {
    it(`should set font-${weight}`, () => {
      const result = changeFontWeight('', weight);
      expect(result).toBe(`font-${weight}`);
    });
  });

  it('should not add font-normal (default)', () => {
    const result = changeFontWeight('font-bold', 'normal');
    expect(result).toBe('');
  });

  it('should replace existing font weight', () => {
    const result = changeFontWeight('font-bold text-lg', 'semibold');
    expect(result).toBe('text-lg font-semibold');
    expect(result).not.toContain('font-bold');
  });
});

// ============================================================================
// 5.4.4 - Line Height Tests
// ============================================================================

describe('5.4.4: Line height - all values', () => {
  const lineHeights = ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose'];

  lineHeights.forEach(lh => {
    it(`should set leading-${lh}`, () => {
      let classes = setClass('', /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[.+\])$/, null);
      classes = classes + ` leading-${lh}`;
      expect(classes.trim()).toBe(`leading-${lh}`);
    });
  });

  it('should replace existing line height', () => {
    let classes = 'leading-tight text-lg';
    classes = setClass(classes, /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[.+\])$/, null);
    classes = classes + ` leading-loose`;
    expect(classes.trim()).toBe('text-lg leading-loose');
  });
});

// ============================================================================
// 5.4.5 - Letter Spacing Tests
// ============================================================================

describe('5.4.5: Letter spacing - tighter to wider', () => {
  const letterSpacings = ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'];

  letterSpacings.forEach(ls => {
    it(`should set tracking-${ls}`, () => {
      let classes = setClass('', /^tracking-(tighter|tight|normal|wide|wider|widest|\[.+\])$/, null);
      classes = classes + ` tracking-${ls}`;
      expect(classes.trim()).toBe(`tracking-${ls}`);
    });
  });
});

// ============================================================================
// 5.4.6 - Text Align Tests
// ============================================================================

describe('5.4.6: Text align - left/center/right/justify', () => {
  const alignments = ['left', 'center', 'right', 'justify'];

  alignments.forEach(align => {
    it(`should set text-${align}`, () => {
      let classes = setClass('', /^text-(left|center|right|justify)$/, null);
      classes = classes + ` text-${align}`;
      expect(classes.trim()).toBe(`text-${align}`);
    });
  });

  it('should replace existing alignment', () => {
    let classes = 'text-left text-lg';
    classes = setClass(classes, /^text-(left|center|right|justify)$/, null);
    classes = classes + ` text-center`;
    expect(classes.trim()).toBe('text-lg text-center');
  });
});

// ============================================================================
// 5.4.7 - Text Color Tests
// ============================================================================

describe('5.4.7: Text color - all palette colors', () => {
  const colors = ['slate', 'gray', 'zinc', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

  it('should set text-white', () => {
    const result = changeTextColor('', 'text-white');
    expect(result).toBe('text-white');
  });

  it('should set text-black', () => {
    const result = changeTextColor('', 'text-black');
    expect(result).toBe('text-black');
  });

  it('should set text-transparent', () => {
    const result = changeTextColor('', 'text-transparent');
    expect(result).toBe('text-transparent');
  });

  // Test a few color combinations
  ['blue-500', 'red-600', 'green-400', 'purple-900'].forEach(color => {
    it(`should set text-${color}`, () => {
      const result = changeTextColor('', `text-${color}`);
      expect(result).toBe(`text-${color}`);
    });
  });

  it('should replace existing text color', () => {
    const result = changeTextColor('text-blue-500 text-lg', 'text-red-500');
    expect(result).toBe('text-lg text-red-500');
    expect(result).not.toContain('text-blue-500');
  });

  it('should handle arbitrary hex colors', () => {
    const result = changeTextColor('', 'text-[#ff5500]');
    expect(result).toBe('text-[#ff5500]');
  });
});

// ============================================================================
// 5.4.8-5.4.13: CRITICAL - Slot Isolation Tests
// These tests verify the bug fix for "font change resets color"
// ============================================================================

describe('5.4.8: Font family change preserves text color', () => {
  it('should preserve text color when changing font family', () => {
    const initial = 'font-sans text-blue-500';
    const result = changeFontFamily(initial, 'serif');

    expect(result).toContain('text-blue-500');
    expect(result).toContain('font-serif');
    expect(result).not.toContain('font-sans');
  });

  it('should preserve arbitrary hex color when changing font family', () => {
    const initial = 'font-mono text-[#ff5500]';
    const result = changeFontFamily(initial, 'sans');

    expect(result).toContain('text-[#ff5500]');
    expect(result).toContain('font-sans');
  });
});

describe('5.4.9: Font size change preserves text color', () => {
  it('should preserve text color when changing font size', () => {
    const initial = 'text-lg text-blue-500';
    const result = changeFontSize(initial, 'xl');

    expect(result).toContain('text-blue-500');
    expect(result).toContain('text-xl');
    expect(result).not.toContain('text-lg');
  });

  it('should preserve complex color when changing to arbitrary size', () => {
    const initial = 'text-sm text-emerald-700';
    const result = changeFontSize(initial, '[18px]');

    expect(result).toContain('text-emerald-700');
    expect(result).toContain('text-[18px]');
  });
});

describe('5.4.10: Font weight change preserves text color', () => {
  it('should preserve text color when changing font weight', () => {
    const initial = 'font-normal text-red-500';
    const result = changeFontWeight(initial, 'bold');

    expect(result).toContain('text-red-500');
    expect(result).toContain('font-bold');
  });

  it('should preserve text color when removing font weight', () => {
    const initial = 'font-bold text-purple-500';
    const result = changeFontWeight(initial, 'normal');

    expect(result).toContain('text-purple-500');
    expect(result).not.toContain('font-bold');
  });
});

describe('5.4.11: Text color change preserves font family', () => {
  it('should preserve font family when changing text color', () => {
    const initial = 'font-serif text-blue-500';
    const result = changeTextColor(initial, 'text-red-500');

    expect(result).toContain('font-serif');
    expect(result).toContain('text-red-500');
    expect(result).not.toContain('text-blue-500');
  });

  it('should preserve font size when changing text color', () => {
    const initial = 'text-2xl text-blue-500';
    const result = changeTextColor(initial, 'text-green-500');

    expect(result).toContain('text-2xl');
    expect(result).toContain('text-green-500');
  });
});

describe('5.4.12: Sequential - color then font then verify color intact', () => {
  it('should preserve color after: initial -> change color -> change font', () => {
    let classes = 'text-lg text-blue-500';

    // Step 1: Change color to red
    classes = changeTextColor(classes, 'text-red-500');
    expect(classes).toContain('text-red-500');
    expect(classes).toContain('text-lg');

    // Step 2: Change font size
    classes = changeFontSize(classes, '2xl');
    expect(classes).toContain('text-2xl');

    // CRITICAL: Color must still be red
    expect(classes).toContain('text-red-500');
    expect(classes).not.toContain('text-blue-500');
  });

  it('should preserve color through: initial -> font family -> font size -> verify color', () => {
    let classes = 'font-sans text-sm text-purple-500';

    // Step 1: Change font family
    classes = changeFontFamily(classes, 'serif');
    expect(classes).toContain('font-serif');
    expect(classes).toContain('text-purple-500');

    // Step 2: Change font size
    classes = changeFontSize(classes, 'xl');
    expect(classes).toContain('text-xl');

    // CRITICAL: Color must still be purple
    expect(classes).toContain('text-purple-500');
  });
});

describe('5.4.13: Sequential - font then color then font then verify color', () => {
  it('should handle complex sequence of typography changes', () => {
    let classes = 'text-base text-gray-900 font-normal';

    // Step 1: Change font size
    classes = changeFontSize(classes, 'lg');
    expect(classes).toContain('text-lg');
    expect(classes).toContain('text-gray-900');

    // Step 2: Change color
    classes = changeTextColor(classes, 'text-blue-600');
    expect(classes).toContain('text-blue-600');
    expect(classes).toContain('text-lg');

    // Step 3: Change font size again
    classes = changeFontSize(classes, '2xl');
    expect(classes).toContain('text-2xl');

    // CRITICAL: Color must still be blue
    expect(classes).toContain('text-blue-600');
    expect(classes).not.toContain('text-gray-900');
  });

  it('should preserve all typography properties through multiple changes', () => {
    let classes = 'font-sans text-base text-black font-medium leading-normal';

    // Sequence of changes
    classes = changeFontFamily(classes, 'mono');
    classes = changeFontSize(classes, 'xl');
    classes = changeTextColor(classes, 'text-indigo-500');
    classes = changeFontWeight(classes, 'bold');
    classes = changeFontSize(classes, '3xl');

    // All final values should be present
    expect(classes).toContain('font-mono');
    expect(classes).toContain('text-3xl');
    expect(classes).toContain('text-indigo-500');
    expect(classes).toContain('font-bold');
    expect(classes).toContain('leading-normal');
  });
});

// ============================================================================
// 5.4.14 - Text Decoration Tests
// ============================================================================

describe('5.4.14: Text decoration - underline/line-through/none', () => {
  const decorations = ['underline', 'line-through', 'overline'];

  decorations.forEach(dec => {
    it(`should set ${dec}`, () => {
      let classes = setClass('', /^(underline|line-through|overline|no-underline)$/, null);
      classes = classes + ` ${dec}`;
      expect(classes.trim()).toBe(dec);
    });
  });

  it('should remove decoration with no-underline', () => {
    let classes = 'underline text-lg';
    classes = setClass(classes, /^(underline|line-through|overline|no-underline)$/, null);
    expect(classes.trim()).toBe('text-lg');
  });
});

// ============================================================================
// 5.4.15 - Text Transform Tests
// ============================================================================

describe('5.4.15: Text transform - uppercase/lowercase/capitalize', () => {
  const transforms = ['uppercase', 'lowercase', 'capitalize'];

  transforms.forEach(transform => {
    it(`should set ${transform}`, () => {
      let classes = setClass('', /^(uppercase|lowercase|capitalize|normal-case)$/, null);
      classes = classes + ` ${transform}`;
      expect(classes.trim()).toBe(transform);
    });
  });

  it('should replace existing transform', () => {
    let classes = 'uppercase text-lg';
    classes = setClass(classes, /^(uppercase|lowercase|capitalize|normal-case)$/, null);
    classes = classes + ` lowercase`;
    expect(classes.trim()).toBe('text-lg lowercase');
  });
});

// ============================================================================
// 5.4.16 - Text Overflow Tests
// ============================================================================

describe('5.4.16: Text overflow - truncate/ellipsis', () => {
  const overflows = ['truncate', 'text-ellipsis', 'text-clip'];

  overflows.forEach(overflow => {
    it(`should set ${overflow}`, () => {
      let classes = setClass('', /^(truncate|text-ellipsis|text-clip)$/, null);
      classes = classes + ` ${overflow}`;
      expect(classes.trim()).toBe(overflow);
    });
  });
});

// ============================================================================
// 5.4.17 - Whitespace Tests
// ============================================================================

describe('5.4.17: Whitespace - nowrap/pre/pre-line/pre-wrap', () => {
  const whitespaces = ['whitespace-nowrap', 'whitespace-pre', 'whitespace-pre-line', 'whitespace-pre-wrap', 'whitespace-break-spaces'];

  whitespaces.forEach(ws => {
    it(`should set ${ws}`, () => {
      let classes = setClass('', /^whitespace-(normal|nowrap|pre|pre-line|pre-wrap|break-spaces)$/, null);
      classes = classes + ` ${ws}`;
      expect(classes.trim()).toBe(ws);
    });
  });
});

// ============================================================================
// 5.4.18 - Word Break Tests
// ============================================================================

describe('5.4.18: Word break - normal/words/all/keep', () => {
  const wordBreaks = ['break-normal', 'break-words', 'break-all', 'break-keep'];

  wordBreaks.forEach(wb => {
    it(`should parse ${wb}`, () => {
      const token = findClass(wb, /^break-(normal|words|all|keep)$/);
      expect(token).toBe(wb);
    });
  });
});

// ============================================================================
// 5.4.19 - Breakpoint-specific Typography
// ============================================================================

describe('5.4.19: Breakpoint-specific typography', () => {
  it('should cascade font size from xs to md', () => {
    const storage = parseClasses('text-sm md:text-lg');

    const xsEffective = getEffectiveClasses(storage, 'xs', 'light', 'default');
    const mdEffective = getEffectiveClasses(storage, 'md', 'light', 'default');

    expect(xsEffective).toContain('text-sm');
    expect(mdEffective).toContain('text-lg');
  });

  it('should inherit xs typography at larger breakpoints', () => {
    const storage = parseClasses('text-blue-500 font-bold');

    const smEffective = getEffectiveClasses(storage, 'sm', 'light', 'default');
    const lgEffective = getEffectiveClasses(storage, 'lg', 'light', 'default');

    expect(smEffective).toContain('text-blue-500');
    expect(smEffective).toContain('font-bold');
    expect(lgEffective).toContain('text-blue-500');
    expect(lgEffective).toContain('font-bold');
  });
});

// ============================================================================
// 5.4.20 - Theme-specific Text Colors
// ============================================================================

describe('5.4.20: Theme-specific text colors (dark mode)', () => {
  it('should apply dark mode text color', () => {
    const storage = parseClasses('text-gray-900 dark:text-gray-100');

    const lightEffective = getEffectiveClasses(storage, 'xs', 'light', 'default');
    const darkEffective = getEffectiveClasses(storage, 'xs', 'dark', 'default');

    expect(lightEffective).toContain('text-gray-900');
    expect(darkEffective).toContain('text-gray-100');
  });

  it('should inherit light theme color in dark mode if not overridden', () => {
    const storage = parseClasses('text-blue-500');

    const darkEffective = getEffectiveClasses(storage, 'xs', 'dark', 'default');

    expect(darkEffective).toContain('text-blue-500');
  });
});

// ============================================================================
// 5.4.21 - Hover State Text Color
// ============================================================================

describe('5.4.21: Hover state text color', () => {
  it('should apply hover state text color', () => {
    const storage = parseClasses('text-blue-500 hover:text-blue-700');

    const defaultEffective = getEffectiveClasses(storage, 'xs', 'light', 'default');
    const hoverEffective = getEffectiveClasses(storage, 'xs', 'light', 'hover');

    expect(defaultEffective).toContain('text-blue-500');
    expect(hoverEffective).toContain('text-blue-700');
  });
});

// ============================================================================
// 5.4.22 - Multiple Typography Properties
// ============================================================================

describe('5.4.22: Multiple typography properties at once', () => {
  it('should handle all typography properties together', () => {
    const classes = 'font-serif text-2xl font-bold text-indigo-600 leading-tight tracking-wide text-center uppercase underline';

    // Verify all can be parsed independently
    expect(findClass(classes, /^font-(sans|serif|mono)$/)).toBe('font-serif');
    expect(findClass(classes, /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\[.+\])$/)).toBe('text-2xl');
    expect(findClass(classes, /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/)).toBe('font-bold');
    expect(findClass(classes, /^text-(indigo)-(\d+)$/)).toBe('text-indigo-600');
    expect(findClass(classes, /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[.+\])$/)).toBe('leading-tight');
    expect(findClass(classes, /^tracking-(tighter|tight|normal|wide|wider|widest|\[.+\])$/)).toBe('tracking-wide');
    expect(findClass(classes, /^text-(left|center|right|justify)$/)).toBe('text-center');
  });
});

// ============================================================================
// 5.4.23 - Clear Individual Property
// ============================================================================

describe('5.4.23: Clear individual property', () => {
  it('should clear font family without affecting other properties', () => {
    const initial = 'font-sans text-lg text-blue-500';
    const result = changeFontFamily(initial, '');

    expect(result).not.toContain('font-sans');
    expect(result).toContain('text-lg');
    expect(result).toContain('text-blue-500');
  });

  it('should clear font size without affecting other properties', () => {
    const initial = 'text-lg text-blue-500 font-bold';
    const result = changeFontSize(initial, '');

    expect(result).not.toContain('text-lg');
    expect(result).toContain('text-blue-500');
    expect(result).toContain('font-bold');
  });

  it('should clear text color without affecting other properties', () => {
    const initial = 'text-lg text-blue-500 font-bold';
    const result = changeTextColor(initial, '');

    expect(result).not.toContain('text-blue-500');
    expect(result).toContain('text-lg');
    expect(result).toContain('font-bold');
  });
});

// ============================================================================
// 5.4.24 - Typography Inheritance
// ============================================================================

describe('5.4.24: Typography inheritance', () => {
  it('should inherit base typography at all breakpoints', () => {
    const storage = parseClasses('text-lg text-blue-500 font-bold');

    const breakpoints = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
    breakpoints.forEach(bp => {
      const effective = getEffectiveClasses(storage, bp, 'light', 'default');
      expect(effective).toContain('text-lg');
      expect(effective).toContain('text-blue-500');
      expect(effective).toContain('font-bold');
    });
  });

  it('should override specific property at breakpoint while inheriting others', () => {
    const storage = parseClasses('text-sm text-blue-500 md:text-lg');

    const mdEffective = getEffectiveClasses(storage, 'md', 'light', 'default');

    // Size overridden
    expect(mdEffective).toContain('text-lg');
    expect(mdEffective).not.toContain('text-sm');
    // Color inherited
    expect(mdEffective).toContain('text-blue-500');
  });
});
