import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  listCustomThemes, saveCustomTheme, deleteCustomTheme, restoreCustomTheme,
  getActiveStyleId, setActiveStyleId,
  getActiveStyleName, getActiveStyleSection, listBundledThemes,
  extractStylePreview, loadBundledThemes,
} from '../styleLibrary';
import { DEFAULT_SYSTEM_PROMPT } from '../../prompts/userPrompts';

const PROJECT = 'browser_test';

beforeAll(() => loadBundledThemes()); // themes.json is lazy; tests need it resolved
beforeEach(() => localStorage.clear());

describe('custom themes (global)', () => {
  it('save → list → update → delete round-trip', () => {
    const t = saveCustomTheme({ name: 'My style', markdown: '# hi' });
    expect(listCustomThemes()).toHaveLength(1);
    saveCustomTheme({ id: t.id, name: 'Renamed', markdown: '# hi2' });
    expect(listCustomThemes()).toHaveLength(1);
    expect(listCustomThemes()[0].name).toBe('Renamed');
    deleteCustomTheme(t.id);
    expect(listCustomThemes()).toHaveLength(0);
  });
});

describe('active style (per-project)', () => {
  it('defaults to null; set/get round-trips; null clears', () => {
    expect(getActiveStyleId(PROJECT)).toBeNull();
    setActiveStyleId(PROJECT, 'bundled:apple');
    expect(getActiveStyleId(PROJECT)).toBe('bundled:apple');
    expect(getActiveStyleId('browser_other')).toBeNull(); // per-project
    setActiveStyleId(PROJECT, null);
    expect(getActiveStyleId(PROJECT)).toBeNull();
  });

  it('deleting the active custom theme falls back to no style', () => {
    const t = saveCustomTheme({ name: 'X', markdown: 'body' });
    setActiveStyleId(PROJECT, `custom:${t.id}`);
    deleteCustomTheme(t.id);
    expect(getActiveStyleSection(PROJECT)).toBeUndefined(); // dangling → no style
  });
});

describe('extractStylePreview', () => {
  it('pulls primary/canvas/ink/font/swatches from a DESIGN.md-shaped doc', () => {
    const md = [
      'colors:',
      '  primary: "#0066cc"',
      '  ink: "#1d1d1f"',
      '  canvas: "#ffffff"',
      '  hairline: "#e0e0e0"',
      'typography:',
      '  hero:',
      '    fontFamily: "SF Pro Display, system-ui, sans-serif"',
    ].join('\n');
    const p = extractStylePreview(md)!;
    expect(p.primary).toBe('#0066cc');
    expect(p.canvas).toBe('#ffffff');
    expect(p.ink).toBe('#1d1d1f');
    expect(p.font).toContain('SF Pro Display');
    expect(p.swatches).toContain('#e0e0e0');
    expect(p.swatches.length).toBeLessThanOrEqual(8);
  });

  it('returns null when no hex colors exist; extracts for most bundled themes', () => {
    expect(extractStylePreview('# just prose, no colors')).toBeNull();
    const withPreview = listBundledThemes().filter(t => extractStylePreview(t.markdown));
    expect(withPreview.length).toBeGreaterThan(listBundledThemes().length * 0.5);
  });
});

describe('getActiveStyleSection / getActiveStyleName', () => {
  it('bundled hit wraps markdown under ## Style Prompt', () => {
    const first = listBundledThemes()[0];
    setActiveStyleId(PROJECT, `bundled:${first.id}`);
    const section = getActiveStyleSection(PROJECT)!;
    expect(section.startsWith(`## Style Prompt (ACTIVE STYLE: ${first.name})`)).toBe(true);
    expect(section).toContain(first.markdown.slice(0, 40));
    expect(getActiveStyleName(PROJECT)).toBe(first.name);
  });

  // Regression (2026-07-25): sections built after a style switch kept the FIRST
  // style — the model obeyed the base prompt's token-only/match-existing rules
  // and copied the old sections. The section must explicitly claim precedence
  // over the Design Style block, earlier sections, and chat history.
  it('section asserts precedence over base design rules and earlier styles', () => {
    const first = listBundledThemes()[0];
    setActiveStyleId(PROJECT, `bundled:${first.id}`);
    const section = getActiveStyleSection(PROJECT)!;
    expect(section).toContain('OVERRIDES the "Design Style (MANDATORY)" rules');
    expect(section).toContain('arbitrary values like bg-[#0066cc] are allowed');
    expect(section).toContain('Do NOT copy the look of existing page sections');
    expect(section).toContain('earlier in this conversation');
  });

  it('base prompt names the Style Prompt section as the override for its Design Style block', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('"## Style Prompt" section is present below, it OVERRIDES this entire Design Style block');
  });

  it('custom hit resolves; none/dangling/missing-project → undefined', () => {
    const t = saveCustomTheme({ name: 'C', markdown: 'custom body' });
    setActiveStyleId(PROJECT, `custom:${t.id}`);
    expect(getActiveStyleSection(PROJECT)).toContain('custom body');
    expect(getActiveStyleSection('browser_none')).toBeUndefined();
    setActiveStyleId(PROJECT, 'bundled:does-not-exist');
    expect(getActiveStyleSection(PROJECT)).toBeUndefined();
    expect(getActiveStyleName(PROJECT)).toBeNull();
    expect(getActiveStyleSection('')).toBeUndefined();
  });
});

describe('restoreCustomTheme (⌘Z of a style delete)', () => {
  it('puts the exact theme back at its place, once', () => {
    const a = saveCustomTheme({ name: 'A', markdown: 'a' });
    const b = saveCustomTheme({ name: 'B', markdown: 'b' });
    const c = saveCustomTheme({ name: 'C', markdown: 'c' });
    deleteCustomTheme(b.id);
    restoreCustomTheme(b, 1);
    restoreCustomTheme(b, 1); // a second replay never duplicates it
    expect(listCustomThemes()).toEqual([a, b, c]);
  });
});
