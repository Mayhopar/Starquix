import { useRef, useState, type ReactNode } from 'react';
import {
  LayoutSideBySideIcon, LayoutStackedIcon, LayoutSwapIcon, MoreIcon,
  WidthMeasureIcon, WidthWideIcon, WidthFullIcon,
  LayoutRatioLeftIcon, LayoutRatioRightIcon,
} from '@/assets/icons';
import { Button, Menu, MenuItem } from '@/components/ui';
import type { StackRatio, StackWidth } from '@/core/stack/stackClasses';

/**
 * The ONE layout toolbar (design "What the user sees"): Layout · Width ·
 * Color · ⋯. Pure view — every action is a callback the editor turns into a
 * Tiptap transaction. Nested rows have no width group (P3).
 */
export type StackAction =
  | { type: 'direction'; direction: 'row' | 'column' }
  | { type: 'ratio'; ratio: StackRatio }
  | { type: 'swap' }
  | { type: 'width'; width: StackWidth }
  | { type: 'move'; dir: -1 | 1 }
  | { type: 'duplicate' }
  | { type: 'remove-color' }
  | { type: 'delete' };

const RATIOS: Array<{ ratio: StackRatio; label: string; title: string }> = [
  { ratio: '1:1', label: '½ ½', title: 'Equal columns' },
  { ratio: '2:1', label: '⅔ ⅓', title: 'Wider first column' },
  { ratio: '1:2', label: '⅓ ⅔', title: 'Wider second column' },
];

const WIDTHS: Array<{ width: StackWidth; label: string; Icon: typeof WidthMeasureIcon }> = [
  { width: 'reading', label: 'Text width', Icon: WidthMeasureIcon },
  { width: 'wide', label: 'Wide', Icon: WidthWideIcon },
  { width: 'edge', label: 'Full width', Icon: WidthFullIcon },
];

export const Divider = () => <span className="w-px h-4 bg-stroke mx-0.5 self-center" aria-hidden="true" />;

/** Outline proportions share the layout icons' grid and optical weight. */
function RatioIcon({ ratio }: { ratio: StackRatio }) {
  const Icon = ratio === '1:1' ? LayoutSideBySideIcon : ratio === '2:1' ? LayoutRatioLeftIcon : LayoutRatioRightIcon;
  return <Icon className="w-4 h-4" aria-hidden="true" />;
}

export function StackToolbar({ direction, ratio, width, nested, canRow = true, colored, colorControl, onAction }: {
  direction: 'row' | 'column';
  ratio: StackRatio;
  width: StackWidth;
  nested: boolean;
  /** false when a column holds a row — it cannot become a row (D3) */
  canRow?: boolean;
  colored: boolean;
  /** the Color control (Phase 3) — rendered between Width and ⋯ */
  colorControl?: ReactNode;
  onAction: (action: StackAction) => void;
}) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const act = (action: StackAction) => { setMoreOpen(false); onAction(action); };
  return (
    <div role="toolbar" aria-label="Layout" className="flex items-center gap-0.5">
      <Button size="sm" variant="ghost" iconOnly aria-label="Side by side" title={canRow ? 'Side by side' : 'Side by side — not while this section holds a side-by-side layout'}
        active={direction === 'row'} disabled={!canRow} onClick={() => act({ type: 'direction', direction: 'row' })}>
        <LayoutSideBySideIcon className="w-4 h-4" />
      </Button>
      <Button size="sm" variant="ghost" iconOnly aria-label="Stacked" title="Stacked"
        active={direction === 'column'} onClick={() => act({ type: 'direction', direction: 'column' })}>
        <LayoutStackedIcon className="w-4 h-4" />
      </Button>
      {direction === 'row' && <>
        <Divider />
        {RATIOS.map(r => (
          <Button key={r.ratio} size="sm" variant="ghost" iconOnly aria-label={r.title} title={`${r.title} (${r.label})`}
            active={ratio === r.ratio} onClick={() => act({ type: 'ratio', ratio: r.ratio })}>
            <RatioIcon ratio={r.ratio} />
          </Button>
        ))}
        <Button size="sm" variant="ghost" iconOnly aria-label="Swap sides" title="Swap sides" onClick={() => act({ type: 'swap' })}>
          <LayoutSwapIcon className="w-4 h-4" />
        </Button>
      </>}
      {!nested && <>
        <Divider />
        {WIDTHS.map(({ width: w, label, Icon }) => (
          <Button key={w} size="sm" variant="ghost" iconOnly aria-label={label} title={label}
            active={width === w} onClick={() => act({ type: 'width', width: w })}>
            <Icon className="w-4 h-4" />
          </Button>
        ))}
      </>}
      {colorControl && <><Divider />{colorControl}</>}
      <Divider />
      <Button ref={moreRef} size="sm" variant="ghost" iconOnly aria-label="More layout actions" title="More"
        active={moreOpen} onClick={() => setMoreOpen(o => !o)}>
        <MoreIcon className="w-4 h-4" />
      </Button>
      <Menu isOpen={moreOpen} onClose={() => setMoreOpen(false)} triggerRef={moreRef}>
        <MenuItem label="Move up" onSelect={() => act({ type: 'move', dir: -1 })} />
        <MenuItem label="Move down" onSelect={() => act({ type: 'move', dir: 1 })} />
        <MenuItem label="Duplicate" onSelect={() => act({ type: 'duplicate' })} />
        {colored && <MenuItem label="Remove color" onSelect={() => act({ type: 'remove-color' })} />}
        <MenuItem label="Delete" danger onSelect={() => act({ type: 'delete' })} />
      </Menu>
    </div>
  );
}
