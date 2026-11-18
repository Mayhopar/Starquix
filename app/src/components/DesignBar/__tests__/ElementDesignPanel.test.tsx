/**
 * ElementDesignPanel contract (task-043). Renders the element style stack from a
 * `design` bundle + a descriptor read from DesignBarContext. Asserts the section
 * SET per element kind (ledger #1-4), Fill/Image mutual exclusion, Link gating,
 * and that a child block's onClassesChange propagates to the bundle handler.
 *
 * Leaf blocks are stubbed (jsdom SVG-data-URL issue + heavy contexts) to emit
 * section markers — matching the DesignBar.*.test.tsx harnesses. Collapsed
 * sections render only a header until expanded, so the SET is asserted via the
 * header title; Link (no title row) and the expanded Layout block use markers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/context/BreakpointContext', () => ({
  useActiveBreakpoint: () => ({ activeBreakpoint: 'xs', isEditingBreakpoint: false }),
  PRIMARY_BREAKPOINT: 'xs',
}));
// task-141: the panel reads the selection + local-mode path for the
// resolved-media Fill gate — default to a non-local, no-selection state.
let mockSelected: Record<string, unknown> = { key: null, sourceLocation: null, tagName: null };
let mockLocalPath: string | null = null;
vi.mock('../../../context/SelectionContext', async (orig) => {
  const actual = await orig<typeof import('../../../context/SelectionContext')>();
  return {
    ...actual,
    useSelectedElement: () => mockSelected,
  };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => mockLocalPath,
}));
vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) out[k] = () => null;
  return out;
});

vi.mock('../blocks/PositionBlock', () => ({ PositionBlock: () => <div data-testid="sec-position" /> }));
vi.mock('../blocks/AppearanceBlock', () => ({ AppearanceBlock: () => <div data-testid="sec-appearance" /> }));
vi.mock('../blocks/LayoutAppearanceBlock', () => ({
  LayoutAppearanceBlock: ({ onClassesChange }: { onClassesChange: (c: string) => void }) => (
    <button data-testid="sec-layout" onClick={() => onClassesChange('flex')} />
  ),
}));
vi.mock('../blocks/SpacingBlock', () => ({ SpacingBlock: () => <div data-testid="sec-spacing" /> }));
vi.mock('../blocks/TypographyBlock', () => ({ TypographyBlock: () => <div data-testid="sec-typography" /> }));
vi.mock('../blocks/ImageBlock', () => ({ ImageBlock: () => <div data-testid="sec-image" /> }));
vi.mock('../blocks/FillBlock', () => ({ FillBlock: () => <div data-testid="sec-fill" /> }));
vi.mock('../blocks/StrokeBlock', () => ({ StrokeBlock: () => <div data-testid="sec-stroke" /> }));
vi.mock('../blocks/EffectsBlock', () => ({ EffectsBlock: () => <div data-testid="sec-effects" /> }));
vi.mock('../blocks/LinkBlock', () => ({ LinkBlock: () => <div data-testid="sec-link" /> }));
vi.mock('../inputs/ContentFieldPickerPair', () => ({ ContentFieldPickerPair: () => null }));
vi.mock('../BlockOverridePills', async (orig) => {
  const actual = await orig<typeof import('../BlockOverridePills')>();
  return { ...actual, BlockOverridePills: () => null };
});

import { DesignBarProvider } from '../DesignBarContext';
import ElementDesignPanel, { type ElementDesignBundle } from '../ElementDesignPanel';

const baseDesign: ElementDesignBundle = {
  key: 'Hero.astro:5:1',
  currentClasses: '',
  fullClasses: '',
  handleClassesChange: () => {},
  deletePrefixClasses: () => {},
  computedStyles: null,
  isTextElement: false,
  isImageElement: false,
  isEditingText: false,
  isGridChild: false,
  parentGridInfo: { cols: 0, rows: 0, sizeIsExact: false },
  isInsideBlogSlot: false,
  blogSlotKey: null,
  showPostPicker: false,
  postPageSlotKey: null,
  hasFillClasses: false,
  handleAddFill: () => {},
  handleRemoveFill: () => {},
  hasStrokeClasses: false,
  handleAddStroke: () => {},
  handleRemoveStroke: () => {},
  hasEffectsClasses: false,
  handleAddEffects: () => {},
  showLinkBlock: false,
  handleLinkChange: () => {},
  handleUnlink: () => {},
  setLinkInteracting: () => {},
  imageSrc: null,
  imageAlt: null,
  imagePreviewDataUrl: null,
};

function renderPanel(over: Partial<ElementDesignBundle> = {}, effectiveTagName = 'div') {
  const ctx = {
    breakpointOverrides: {},
    activeBreakpoint: 'xs',
    isEditingBreakpoint: false,
    onRemoveBreakpointOverride: () => {},
    descriptor: { effectiveTagName } as never,
  };
  return render(
    <DesignBarProvider value={ctx as never}>
      <ElementDesignPanel design={{ ...baseDesign, ...over }} />
    </DesignBarProvider>,
  );
}

describe('ElementDesignPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelected = { key: null, sourceLocation: null, tagName: null };
    mockLocalPath = null;
  });

  it('generic element: Position/Appearance/Layout/Fill/Stroke/Effects; NO Typography/Image/Link', () => {
    renderPanel({ isTextElement: false, isImageElement: false, showLinkBlock: false });
    expect(screen.getByText('Position')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Layout')).toBeTruthy();
    expect(screen.getByText('Fill')).toBeTruthy();
    expect(screen.getByText('Stroke')).toBeTruthy();
    expect(screen.getByText('Effects')).toBeTruthy();
    expect(screen.queryByText('Typography')).toBeNull();
    expect(screen.queryByText('Image')).toBeNull();
    expect(screen.queryByTestId('sec-link')).toBeNull();
  });

  it('shows Typography only for text', () => {
    renderPanel({ isTextElement: true });
    expect(screen.getByText('Typography')).toBeTruthy();
  });

  // task-144: unified surface — Fill renders for imgs in EVERY runtime; the
  // legacy Image section is retired.
  it('shows Fill and no Image section for img', () => {
    renderPanel({ isImageElement: true });
    expect(screen.getByText('Fill')).toBeTruthy();
    expect(screen.queryByText('Image')).toBeNull();
  });

  // task-141: unification — a LOCAL resolved img has ONE surface: Fill (Media).
  it('local resolved img: shows Fill, hides Image', () => {
    mockLocalPath = '/Users/x/site';
    mockSelected = {
      key: 'src/pages/index.astro:5:3',
      sourceLocation: { file: 'src/pages/index.astro', line: 5, column: 3 },
      tagName: 'img',
    };
    renderPanel({ isImageElement: true }, 'img');
    expect(screen.getByText('Fill')).toBeTruthy();
    expect(screen.queryByText('Image')).toBeNull();
  });

  it('shows Link when showLinkBlock', () => {
    renderPanel({ showLinkBlock: true });
    expect(screen.getByTestId('sec-link')).toBeTruthy();
  });

  it('propagates onClassesChange from a child block', () => {
    const handleClassesChange = vi.fn();
    renderPanel({ handleClassesChange });
    fireEvent.click(screen.getByTestId('sec-layout'));
    expect(handleClassesChange).toHaveBeenCalledWith('flex');
  });
});

it('opening and closing an image\'s Fill never adds or removes document classes', () => {
  const add = vi.fn(), remove = vi.fn(), change = vi.fn();
  renderPanel({ isImageElement: true, hasFillClasses: false, handleAddFill: add, handleRemoveFill: remove, handleClassesChange: change }, 'img');
  fireEvent.click(screen.getByText('Fill')); fireEvent.click(screen.getByText('Fill')); fireEvent.click(screen.getByText('Fill'));
  expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
});

// Owner 2026-10-18: "Fill: unable to delete. Previously there was + and once you click it, – and it opens."
// dffeb79b gave Fill a chevron-only header, so a color fill could not be removed. Non-media elements get
// Stroke's +/– back; an image keeps its always-open Media surface (its Delete lives there).
describe('Fill +/–', () => {
  it('a filled element shows – and it removes the fill', () => {
    const remove = vi.fn();
    renderPanel({ hasFillClasses: true, handleRemoveFill: remove });
    expect(screen.getByTestId('sec-fill')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove fill' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('an element without a fill shows + and it adds one', () => {
    const add = vi.fn();
    renderPanel({ hasFillClasses: false, handleAddFill: add });
    expect(screen.queryByTestId('sec-fill')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add fill' }));
    expect(add).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('sec-fill')).toBeTruthy();
  });

  it('an image has no +/–: its fill is the media', () => {
    renderPanel({ isImageElement: true }, 'img');
    expect(screen.getByTestId('sec-fill')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Add|Remove) fill$/ })).toBeNull();
  });
});
