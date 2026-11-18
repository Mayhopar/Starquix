/**
 * task-118 — orphaned-overrides badge. Shows a count in the DesignBar header
 * when the selected element's astroSource has orphan records (a structural
 * source edit removed elements that held overrides). Hidden entirely at 0
 * (ledger #31). The popover lists each orphan by fingerprint with:
 *   Keep    — close the popover, record stays (default, zero-cost)
 *   Discard — DISCARD_OVERRIDE_ORPHAN via dispatch (undoable; never a direct
 *             Yjs mutation — repo law)
 * Re-target is deferred to v2 (design §6 / v1 scope D3).
 */
import { useRef, useState } from 'react';
import { useYjsValue, useDispatch } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { listOrphansForSource, type OverrideOrphan } from '@/store/overrideOrphans';
import { Badge, Button, Popover, Row } from '@/components/ui';

function fingerprintSummary(o: OverrideOrphan): string {
  const { tag, text } = o.fingerprint;
  const textPart = text ? ` · '${text.length > 24 ? `${text.slice(0, 24)}…` : text}'` : '';
  return `${tag}${textPart}`;
}

function classSummary(o: OverrideOrphan): string {
  const c = o.fingerprint.className;
  return c.length > 32 ? `${c.slice(0, 32)}…` : c;
}

export function OrphanedOverridesBadge({ astroSource }: { astroSource: string | null }) {
  const [open, setOpen] = useState(false);
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const orphanList = useYjsValue((doc) => (astroSource ? listOrphansForSource(doc, astroSource) : []));
  if (!astroSource || orphanList.length === 0) return null;

  const discard = (orphanId: string) => {
    takeSnapshot();
    dispatch({ type: 'DISCARD_OVERRIDE_ORPHAN', orphanId });
  };

  return (
    <span className="inline-flex items-center ml-1.5">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        aria-label={`${orphanList.length} orphaned override${orphanList.length === 1 ? '' : 's'} — review`}
        title="Overrides orphaned by a source edit — review"
        onClick={() => setOpen((v) => !v)}
        className="h-auto w-auto p-0 rounded-full font-normal"
      >
        <Badge variant="warning" size="sm">
          <span aria-hidden>⚠</span>
          <span>{orphanList.length}</span>
        </Badge>
      </Button>
      <Popover
        isOpen={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        placement="bottom-start"
        width={288}
      >
        <div role="dialog" aria-label="Orphaned overrides" className="p-2">
          <div className="mb-1 px-1 text-2xs font-medium text-text-muted">
            Orphaned overrides — the source elements they styled are gone
          </div>
          {orphanList.map(({ id, orphan }) => (
            <Row
              key={id}
              size="sm"
              title={fingerprintSummary(orphan)}
              caption={classSummary(orphan) || undefined}
              rightIcons={
                <Button
                  variant="ghost"
                  size="sm"
                  label="Discard"
                  aria-label={`Discard orphaned override on ${orphan.oldSelector}`}
                  onClick={() => discard(id)}
                  className="h-5 px-1.5 text-3xs font-normal text-error hover:bg-error-subtle hover:text-error"
                />
              }
            />
          ))}
          <div className="mt-1 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              label="Keep"
              aria-label="Keep orphaned overrides"
              onClick={() => setOpen(false)}
              className="h-6 px-2 text-2xs font-normal"
            />
          </div>
        </div>
      </Popover>
    </span>
  );
}
