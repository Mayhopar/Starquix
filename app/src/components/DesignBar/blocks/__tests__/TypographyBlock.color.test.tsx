import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// vitest.config has no svgr plugin, so `*.svg?react` icons resolve to URL strings
// and crash jsdom render. Stub every icon export with a null-rendering component
// (same harness as LayoutAppearanceBlock.gridChild.test.tsx).
vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const Stub = () => null;
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) mocked[key] = Stub;
  return mocked;
});

// TypographyBlock now reads the fonts map via store hooks (task-112) — these
// tests render it without an EditorProvider, so stub the hooks with a bare doc.
vi.mock('@/store/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/hooks')>();
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return {
    ...actual,
    useEditorDoc: () => doc,
    useYjsValue: <T,>(selector: (d: import('yjs').Doc) => T) => selector(doc),
    useDispatch: () => () => true,
  };
});

import { TypographyBlock } from '../TypographyBlock';
import { cssColorToHex } from '../../utils';

/** Pick a preset from a typography field's menu. */
const pick = (field: string, option: string) => {
  fireEvent.click(screen.getByLabelText(`${field} options`));
  fireEvent.click(screen.getByText(option));
};

// task-094 B4: no explicit text-* color class used to render the SAME
// transparent checkerboard as a real text-transparent — black text read as
// "transparent". The computed color IS delivered by the bridge; show it as
// a muted "inherited" swatch (D6), and a distinct slash when even that is
// unavailable. Checkerboard = genuinely transparent only.
describe('TypographyBlock text color display (task-094 B4)', () => {
  const renderBlock = (classes: string, color?: string) =>
    render(
      <TypographyBlock
        classes={classes}
        computedStyles={color !== undefined ? { color } : null}
        onClassesChange={() => {}}
      />,
    );

  // The ui-kit Swatch renders the checkerboard as a conic-gradient underlay;
  // the trigger only mounts a Swatch when a real color class is parsed, so its
  // presence distinguishes transparent/color values from inherited/unset divs.
  const checkerboard = (container: HTMLElement) =>
    container.querySelector('[style*="conic-gradient"]');

  it('shows the computed color as an inherited swatch when no text-color class is set', () => {
    const { container } = renderBlock('text-lg', 'rgb(0, 0, 0)');
    const swatch = screen.getByTestId('color-inherited-swatch');
    expect(swatch.style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(screen.getByText('#000000')).toBeTruthy();
    expect(checkerboard(container)).toBeNull();
  });

  it('still shows the transparent checkerboard when text-transparent IS set', () => {
    const { container } = renderBlock('text-transparent text-lg', 'rgba(0, 0, 0, 0)');
    expect(checkerboard(container)).not.toBeNull();
    expect(screen.queryByTestId('color-inherited-swatch')).toBeNull();
  });

  it('shows a distinct unset indicator (not checkerboard) when no class AND no computed color', () => {
    const { container } = renderBlock('text-lg');
    expect(screen.getByTestId('color-unset-indicator')).toBeTruthy();
    expect(screen.queryByTestId('color-inherited-swatch')).toBeNull();
    expect(checkerboard(container)).toBeNull();
  });

  it('explicit color class wins over the computed fallback', () => {
    renderBlock('text-red-500', 'rgb(0, 0, 0)');
    expect(screen.queryByTestId('color-inherited-swatch')).toBeNull();
    expect(screen.queryByTestId('color-unset-indicator')).toBeNull();
  });
});

describe('cssColorToHex', () => {
  it('converts rgb()/rgba() to #rrggbb', () => {
    expect(cssColorToHex('rgb(0, 0, 0)')).toBe('#000000');
    expect(cssColorToHex('rgb(255, 128, 0)')).toBe('#ff8000');
    expect(cssColorToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff0000');
  });

  it('returns null for fully transparent, unparseable, or missing values', () => {
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(cssColorToHex('transparent')).toBeNull();
    expect(cssColorToHex('')).toBeNull();
    expect(cssColorToHex(undefined)).toBeNull();
  });
});

// task-262: the block decided "size" with its own regex (any text-[...]), so a
// variable or hex colour read as the size and a size edit deleted it.
describe('TypographyBlock: a variable colour is a colour, not a size (task-262)', () => {
  const renderBlock = (classes: string) => {
    const onClassesChange = vi.fn();
    render(<TypographyBlock classes={classes} computedStyles={null} onClassesChange={onClassesChange} />);
    return { onClassesChange };
  };

  it.each(['text-[var(--ink)]', 'text-[color:var(--ink)]', 'text-[#ff0000]'])('a size edit keeps %s', (color) => {
    const { onClassesChange } = renderBlock(color);
    pick('Font size', '18');
    expect(onClassesChange).toHaveBeenCalledWith(`${color} text-lg`, expect.any(Function));
  });

  it.each(['text-[var(--ink)]', 'text-[color:var(--ink)]'])('%s shows as the variable and a colour pick replaces it, keeping the size', (color) => {
    const { onClassesChange } = renderBlock(`${color} text-lg`);
    fireEvent.click(screen.getByText('--ink'));
    fireEvent.click(screen.getByTitle('red-500'));
    expect(onClassesChange).toHaveBeenCalledWith('text-lg text-red-500', expect.any(Function));
  });
});

// Found live 2026-11-12: on `font-[var(--heavy)]` the Weight select showed "Regular"
// and a pick wrote `font-light` BESIDE the variable weight.
describe('TypographyBlock weight: an arbitrary weight is the weight', () => {
  const renderBlock = (classes: string) => {
    const onClassesChange = vi.fn();
    const { container } = render(<TypographyBlock classes={classes} computedStyles={null} onClassesChange={onClassesChange} />);
    return { weight: container.querySelector<HTMLInputElement>('input[aria-label="Font weight"]')!, onClassesChange };
  };

  it('shows the variable, and a pick replaces it', () => {
    const { weight, onClassesChange } = renderBlock('font-[var(--heavy)] font-serif');
    expect(weight.value).toBe('--heavy');
    pick('Font weight', 'Light');
    expect(onClassesChange).toHaveBeenCalledWith('font-serif font-light', expect.any(Function));
  });

  it('shows a numeric weight; Regular removes it', () => {
    const { weight, onClassesChange } = renderBlock('font-[650] text-lg');
    expect(weight.value).toBe('650');
    pick('Font weight', 'Regular');
    expect(onClassesChange).toHaveBeenCalledWith('text-lg', expect.any(Function));
  });

  it('a named weight still shows as its option', () => {
    expect(renderBlock('font-bold').weight.value).toBe('Bold');
    expect(renderBlock('text-lg').weight.value).toBe('Regular');
  });
});
