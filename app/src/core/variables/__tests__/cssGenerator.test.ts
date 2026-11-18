// src/core/variables/__tests__/cssGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { generateCSS, generateCollectionsCSS, SQ_BASE_CSS } from '../cssGenerator';
import type { VariableCollection } from '../types';

function makeCollection(overrides: Partial<VariableCollection> = {}): VariableCollection {
  return {
    id: 'col-1',
    name: 'Variables',
    modes: [
      { id: 'light', name: 'Light', isDefault: true },
      { id: 'dark', name: 'Dark', isDefault: false },
    ],
    variables: [
      {
        id: 'v1',
        name: 'accent',
        type: 'color',
        values: {
          light: { type: 'color', hex: '#FF0000', opacity: 100 },
          dark: { type: 'color', hex: '#1A1A1A', opacity: 100 },
        },
      },
    ],
    ...overrides,
  };
}

describe('generateCSS', () => {
  it('renders the default mode in :root and other modes in [data-mode] blocks', () => {
    expect(generateCSS(makeCollection())).toBe(
      ':root {\n' +
      '  /* Colors */\n' +
      '  --accent: #FF0000;\n' +
      '}\n' +
      '\n' +
      '[data-mode="dark"] {\n' +
      '  --accent: #1A1A1A;\n' +
      '}\n',
    );
  });

  it('emits 8-digit hex when opacity < 100', () => {
    const col = makeCollection({
      variables: [{
        id: 'v1',
        name: 'overlay',
        type: 'color',
        values: { light: { type: 'color', hex: '#FF0000', opacity: 50 } },
      }],
    });
    // round(0.5 * 255) = 128 = 0x80
    expect(generateCSS(col)).toContain('--overlay: #FF000080;');
  });

  it('renders number variables with their unit under a Numbers group', () => {
    const col = makeCollection({
      variables: [{
        id: 'v1',
        name: 'space-md',
        type: 'number',
        values: { light: { type: 'number', value: 16, unit: 'px' } },
      }],
    });
    const css = generateCSS(col);
    expect(css).toContain('/* Numbers */');
    expect(css).toContain('--space-md: 16px;');
  });

  // The contract the AI's `unit` hint rests on: "" is a bare number (a font
  // weight of 800px is no weight — found live 2026-11-12).
  it('renders a number with an empty unit as a bare number', () => {
    const col = makeCollection({
      variables: [{
        id: 'v1',
        name: 'heavy',
        type: 'number',
        values: { light: { type: 'number', value: 800, unit: '' } },
      }],
    });
    expect(generateCSS(col)).toContain('--heavy: 800;');
  });
});

describe('generateCollectionsCSS', () => {
  it('is the Starquix base rule alone for no collections', () => {
    expect(generateCollectionsCSS([])).toBe(SQ_BASE_CSS);
  });

  // Owner ruling 2026-09-11: margins never collapse — the rule ships in the
  // managed stylesheet so editor, preview and export agree. Zero specificity.
  it('the base rule is a zero-specificity flow-root on block containers only', () => {
    expect(SQ_BASE_CSS).toMatch(/^\/\* sq-base[^\n]*\*\/\n:where\([^)]*\) \{ display: flow-root; \}\n$/);
    expect(SQ_BASE_CSS).not.toMatch(/\b(li|summary|table|span|a)\b/);
  });

  it('is generateCSS for a single collection', () => {
    const col = makeCollection();
    expect(generateCollectionsCSS([col])).toBe(SQ_BASE_CSS + generateCSS(col));
  });

  it('joins multiple collections with a single newline (matching the preview injection)', () => {
    const a = makeCollection();
    const b = makeCollection({
      id: 'col-2',
      variables: [{
        id: 'v2',
        name: 'radius',
        type: 'number',
        values: { light: { type: 'number', value: 8, unit: 'px' } },
      }],
    });
    expect(generateCollectionsCSS([a, b])).toBe(SQ_BASE_CSS + generateCSS(a) + '\n' + generateCSS(b));
  });
});
