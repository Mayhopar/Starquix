import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { selectProjectFonts, generateFontsCss } from '../fontSelectors';

const entry = {
  source: 'google' as const,
  css: "@font-face{font-family:'Inter';src:url('sq-asset:a1');}",
  assetIds: ['a1'],
};

describe('SET_PROJECT_FONT / REMOVE_PROJECT_FONT', () => {
  it('SET_PROJECT_FONT stores the entry, selector round-trips it', () => {
    const doc = new Y.Doc();
    expect(applyCommand(doc, { type: 'SET_PROJECT_FONT', family: 'Inter', entry })).toBe(true);
    expect(selectProjectFonts(doc)).toEqual({ Inter: entry });
  });
  it('REMOVE_PROJECT_FONT deletes; returns false for unknown family', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_PROJECT_FONT', family: 'Inter', entry });
    expect(applyCommand(doc, { type: 'REMOVE_PROJECT_FONT', family: 'Inter' })).toBe(true);
    expect(selectProjectFonts(doc)).toEqual({});
    expect(applyCommand(doc, { type: 'REMOVE_PROJECT_FONT', family: 'Nope' })).toBe(false);
  });
  it('generateFontsCss concatenates entries; empty map → empty string', () => {
    const doc = new Y.Doc();
    expect(generateFontsCss(selectProjectFonts(doc))).toBe('');
    applyCommand(doc, { type: 'SET_PROJECT_FONT', family: 'Inter', entry });
    applyCommand(doc, { type: 'SET_PROJECT_FONT', family: 'Lora', entry: { ...entry, css: 'B' } });
    const css = generateFontsCss(selectProjectFonts(doc));
    expect(css).toContain('Inter');
    expect(css).toContain('B');
  });
});
