/**
 * Slot - typed slot controls for Row (and standalone use).
 *
 * Every control renders inside a fixed bounding box (16×16) so
 * rows align regardless of content. Closed set of types + a `custom` escape
 * hatch that still gets the box (grep for `type: 'custom'` to audit escapes).
 *
 * Slot rules:
 * - hidden slots reserve no space (omit the spec instead of hiding content)
 * - control clicks stop propagation so they never trigger the row onClick
 * - right slots support `showOnHover` (visible only while the row is hovered)
 */
import React from 'react';
import { ChevronTreeIcon } from '@/assets/icons';
import { cx } from './cx';
import { Swatch } from './Swatch';
import { Badge } from './Badge';
import { Skeleton } from './Skeleton';

export type SlotSize = 'md' | 'sm';

export type SlotSpec =
  | { type: 'icon'; icon: React.ReactNode; iconSize?: 16 | 24; className?: string }
  | { type: 'chevron'; expanded: boolean; visible?: boolean; onToggle?: (e: React.MouseEvent) => void }
  | { type: 'checkbox'; checked: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; 'aria-label'?: string }
  | { type: 'radio'; checked: boolean; onChange?: () => void; disabled?: boolean; 'aria-label'?: string }
  | { type: 'toggle'; value: boolean; onChange?: (value: boolean) => void; disabled?: boolean; 'aria-label'?: string }
  | { type: 'swatch'; color: string; className?: string }
  | { type: 'badge'; label: string; variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent' }
  | { type: 'spinner' }
  | { type: 'custom'; node: React.ReactNode; /** widen box to fit-content (e.g. an action Button) */ unboxed?: boolean;
      /** Its loading shape in a Row `skeleton` (classes for a Skeleton, e.g. 'w-44 h-6 rounded-inner'); none = nothing */
      skeleton?: string };

/** Common carrier so callers can attach visibility behavior to any spec. */
export type RowSlotSpec = SlotSpec & { showOnHover?: boolean };

const boxSize: Record<SlotSize, string> = {
  md: 'w-4 h-4',
  sm: 'w-4 h-4',
};
/** A checkbox (14px) sits 8px from its label: its own width + this margin + the Row's title gap (sm 4px, md 6px). */
const CHOICE_BOX: Record<SlotSize, string> = { sm: 'w-3.5 mr-1', md: 'w-3.5 mr-0.5' };
/** The radio (16px, the Figma Radiobutton): 8px to its label in sm rows, 16px in md rows (window option rows). */
const RADIO_BOX: Record<SlotSize, string> = { sm: 'mr-1', md: 'mr-2.5' };

export function SlotBox({
  size = 'md',
  className = '',
  children,
  onClick,
}: {
  size?: SlotSize;
  className?: string;
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      className={cx('flex items-center justify-center shrink-0', boxSize[size], className)}
      onClick={onClick}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        'inline-block w-4 h-4 rounded-full border-2 border-stroke border-t-text-muted animate-spin',
        className,
      )}
    />
  );
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

/** A slot in a skeleton row (Row `skeleton`): the same outer box — size and margins — as the real control, as a pulsing
 *  shape, so loaded rows land exactly on their placeholders. `custom` draws the shape it declares (`skeleton`), else nothing. */
export function renderSlotSkeleton(spec: SlotSpec, size: SlotSize = 'md'): React.ReactNode {
  switch (spec.type) {
    case 'radio': return <Skeleton className={cx('shrink-0 w-4 h-4 rounded-full', RADIO_BOX[size])} />;
    case 'checkbox': return <Skeleton className={cx('shrink-0 h-3.5 rounded-sm', CHOICE_BOX[size])} />;
    case 'toggle': return <Skeleton className="shrink-0 w-7 h-4 rounded-full" />;
    case 'spinner': return <Skeleton className="shrink-0 w-4 h-4 rounded-full" />;
    case 'badge': return <Skeleton className="shrink-0 w-10 h-4 rounded-full" />;
    case 'icon': return <Skeleton className={cx('shrink-0 rounded-inner', spec.iconSize === 24 ? 'w-6 h-6' : 'w-4 h-4')} />;
    case 'chevron':
    case 'swatch': return <Skeleton className="shrink-0 w-4 h-4 rounded-inner" />;
    case 'custom': return spec.skeleton ? <Skeleton className={cx('shrink-0', spec.skeleton)} /> : null;
  }
}

export function renderSlot(spec: SlotSpec, size: SlotSize = 'md'): React.ReactNode {
  switch (spec.type) {
    case 'icon':
      return (
        <SlotBox size={size} className={cx('sq-icon-slot text-text-secondary', `sq-icon-size-${spec.iconSize ?? 16}`, spec.className)}>
          {spec.icon}
        </SlotBox>
      );
    case 'chevron': {
      const visible = spec.visible ?? true;
      return (
        <SlotBox size={size}>
          <button
            type="button"
            aria-label={spec.expanded ? 'Collapse' : 'Expand'}
            aria-expanded={spec.expanded}
            className={cx(
              'flex items-center justify-center w-full h-full bg-transparent border-none p-0 cursor-pointer text-text-secondary hover:text-text-muted-hover', // idle tree chevron = idle row icon (Text/Secondary; owner 2026-10-22)
              !visible && 'invisible',
            )}
            onClick={(e) => {
              e.stopPropagation();
              spec.onToggle?.(e);
            }}
            onDoubleClick={stop}
            onPointerDown={stop}
          >
            <ChevronTreeIcon
              className={cx('w-4 h-4 transition-transform duration-150', spec.expanded ? 'rotate-0' : '-rotate-90')}
            />
          </button>
        </SlotBox>
      );
    }
    case 'checkbox':
      return (
        <SlotBox size={size} className={CHOICE_BOX[size]} onClick={stop}>
          <input
            type="checkbox"
            checked={spec.checked}
            disabled={spec.disabled}
            aria-label={spec['aria-label']}
            onChange={(e) => spec.onChange?.(e.target.checked)}
            className="w-3.5 h-3.5 accent-accent cursor-pointer disabled:cursor-default"
          />
        </SlotBox>
      );
    case 'radio':
      return (
        <SlotBox size={size} className={cx('relative', RADIO_BOX[size])} onClick={stop}>
          <input
            type="radio"
            checked={spec.checked}
            disabled={spec.disabled}
            aria-label={spec['aria-label']}
            onChange={() => spec.onChange?.()}
            // The Figma Radiobutton, not the platform's tinted radio: a filled circle with a ring; checked adds an 8px dot.
            className="peer appearance-none w-4 h-4 rounded-full border border-stroke-darker bg-input-fill cursor-pointer disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-stroke-active"
          />
          <span aria-hidden className="pointer-events-none absolute inset-1 rounded-full bg-text-muted opacity-0 peer-checked:opacity-100 peer-checked:peer-disabled:opacity-50" />
        </SlotBox>
      );
    case 'toggle':
      return (
        // Toggle is wider than the box on purpose; the box centers it.
        <SlotBox size={size} className="w-7" onClick={stop}>
          <button
            type="button"
            role="switch"
            aria-checked={spec.value}
            aria-label={spec['aria-label']}
            disabled={spec.disabled}
            onClick={(e) => {
              e.stopPropagation();
              spec.onChange?.(!spec.value);
            }}
            className={cx(
              'relative w-7 h-4 rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default',
              spec.value ? 'bg-accent' : 'bg-stroke-darker',
            )}
          >
            <span
              className={cx(
                'absolute top-0.5 w-3 h-3 rounded-full bg-bg transition-[left]',
                spec.value ? 'left-3.5' : 'left-0.5',
              )}
            />
          </button>
        </SlotBox>
      );
    case 'swatch':
      return (
        <SlotBox size={size}>
          <Swatch color={spec.color} size={size === 'md' ? 'md' : 'sm'} className={spec.className} />
        </SlotBox>
      );
    case 'badge':
      return <Badge variant={spec.variant}>{spec.label}</Badge>;
    case 'spinner':
      return (
        <SlotBox size={size}>
          <Spinner />
        </SlotBox>
      );
    case 'custom':
      return spec.unboxed ? (
        <span className="flex items-center shrink-0" onClick={stop}>
          {spec.node}
        </span>
      ) : (
        <SlotBox size={size} onClick={stop}>
          {spec.node}
        </SlotBox>
      );
  }
}
