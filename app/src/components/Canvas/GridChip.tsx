import { useRef, useState } from 'react';
import { Button, Field, Popover, Row, SegmentedControl } from '@/components/ui';
import { ChevronDownIcon } from '@/assets/icons';
import { shortcutLabel } from '@/utils/platform';
import { useExclusiveMenu } from './hoverMenu';
import { GRID_LIMITS, setGrid, useGrid, type GridNumberKey, type GridType } from './gridPreferences';

const TYPES = [
  { value: 'columns', label: 'Columns' },
  { value: 'square', label: 'Square' },
];

/** A numeric row of the setup. The typed text lives in a draft so the field can be cleared and retyped; every valid
 *  number commits live (the canvas follows as you type); blur drops the draft and shows the stored value. */
function NumberRow({ projectId, field, title, unit }: {
  projectId: string | null;
  field: GridNumberKey;
  title: string;
  unit?: string;
}) {
  const value = useGrid(projectId)[field];
  const [draft, setDraft] = useState<string | null>(null);
  const [min, max] = GRID_LIMITS[field];
  return (
    <Row size="sm" hover={false} title={title}
      right={[{ type: 'custom', unboxed: true, node: (
        <div className="w-20">
          <Field type="number" size="sm" unit={unit} min={min} max={max} aria-label={title}
            value={draft ?? value}
            onChange={(v) => {
              setDraft(v);
              const n = Number(v);
              if (v.trim() !== '' && Number.isFinite(n)) setGrid(projectId, { [field]: n });
            }}
            onBlur={() => setDraft(null)} />
        </div>
      ) }]} />
  );
}

/**
 * Top-bar "Grid" chip: click opens the setup popover (on/off, type, numbers). Click, not hover like its
 * neighbours — it holds fields, and a hover popover would close under the cursor mid-edit.
 * Design: docs/plans/2026-11-16-layout-grid-design.md
 */
export function GridChip({ projectId }: { projectId: string | null }) {
  const g = useGrid(projectId);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // One top-bar menu at a time: opening this closes an open hover menu, and one opening closes this.
  const close = useExclusiveMenu(open, setOpen);

  return (
    // The wrapper div is what ZoomChip and the breakpoint chips have; without it the chip sits a pixel higher than they do.
    <div>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        active={g.on || open}
        aria-label="Grid options"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="px-3 gap-1.5"
        label="Grid"
        iconRight={
          <span className="flex items-center gap-1">
            {g.on && <span className="text-3xs text-text-muted">{g.type === 'columns' ? `${g.count} col` : `${g.size}px`}</span>}
            <ChevronDownIcon className="w-4 h-4 text-text-muted" />
          </span>
        }
      />
      <Popover isOpen={open} onClose={close} triggerRef={triggerRef} placement="bottom" offset={4} width={240}>
        <div className="p-3 space-y-1" role="group" aria-label="Grid">
          <Row size="sm" hover={false} title="Show grid" rightText={shortcutLabel('⌃G')}
            right={[{ type: 'toggle', value: g.on, 'aria-label': 'Show grid', onChange: (on) => setGrid(projectId, { on }) }]} />
          <Row size="sm" hover={false} title="Type"
            // w-36: the control sizes itself to the segments' content but splits its width equally, so "Columns" truncated.
            right={[{ type: 'custom', unboxed: true, node: (
              <div className="w-36">
                <SegmentedControl options={TYPES} value={g.type} onChange={(v) => setGrid(projectId, { type: v as GridType })} />
              </div>
            ) }]} />
          {g.type === 'columns' ? (
            <>
              <NumberRow projectId={projectId} field="count" title="Columns" />
              <NumberRow projectId={projectId} field="gutter" title="Gutter" unit="px" />
              <NumberRow projectId={projectId} field="margin" title="Margin" unit="px" />
            </>
          ) : (
            <NumberRow projectId={projectId} field="size" title="Size" unit="px" />
          )}
        </div>
      </Popover>
    </div>
  );
}
