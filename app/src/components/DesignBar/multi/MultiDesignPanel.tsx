/**
 * Design Bar while ≥2 elements are selected (design docs/plans/2026-11-16-multi-select-edit-design.md
 * §2, C1–C14). Reuses ElementDesignPanel and the blocks; DesignBarContext.multi feeds each control's
 * "Mixed"; every write goes through useMultiStyleEdit (one save, one ⌘Z, all-or-nothing).
 */
import { useMemo } from 'react';
import ElementDesignPanel, { type ElementDesignBundle, type MultiSection } from '../ElementDesignPanel';
import { DesignBarProvider, useDesignBarContext } from '../DesignBarContext';
import { DesignBarHeader } from '../DesignBarHeader';
import { useMultiStyleEdit } from './useMultiStyleEdit';
import type { ClassSlot } from '@/core/classes/index';

/** Sections shown while ≥2 are selected — every control in them reads "Mixed" and declares what it
 *  owns. Typography only when every member is text (C3); Link, Data, Video, Path are per element (C4). */
export const MULTI_READY: readonly MultiSection[] = ['position', 'appearance', 'layout', 'spacing', 'typography', 'fill', 'stroke', 'effects'];
const noop = () => {};

export function MultiDesignPanel({ memberKeys, slot }: { memberKeys: readonly string[]; slot: ClassSlot }) {
  const outer = useDesignBarContext()!;
  const m = useMultiStyleEdit(memberKeys, slot);
  const value = useMemo(() => ({ ...outer, multi: { memberClasses: m.memberClasses } }), [outer, m.memberClasses]);
  const design: ElementDesignBundle = {
    key: null, fillVariant: '', getCurrentClasses: m.getCurrentClasses,
    currentClasses: m.currentClasses, fullClasses: m.unionClasses,
    handleClassesChange: m.handleClassesChange, deletePrefixClasses: noop, computedStyles: null,
    isTextElement: m.allText, isImageElement: false, isVideoElement: false, hasPenPath: false, isEditingText: false,
    isGridChild: false, parentGridInfo: { cols: 0, rows: 0, sizeIsExact: false }, gridCell: null,
    isInsideBlogSlot: false, blogSlotKey: null, showPostPicker: false, postPageSlotKey: null,
    hasFillClasses: m.hasFill, handleAddFill: () => m.addDefault('bg-white'), handleRemoveFill: () => m.removeMatching([/^bg-/]),
    hasStrokeClasses: m.hasStroke, handleAddStroke: () => m.addDefault('border border-black'),
    handleRemoveStroke: () => m.removeMatching([/^border/, /^outline/, /^ring/]),
    hasEffectsClasses: m.hasEffects, handleAddEffects: () => m.addDefault('shadow-sm'), // ui-lint-line: user-document class generation
    showLinkBlock: false, handleLinkChange: noop, handleUnlink: noop, setLinkInteracting: noop,
    imageSrc: null, imageAlt: null, imagePreviewDataUrl: null, onConvertSvgToShape: null,
    multi: { sections: new Set(MULTI_READY.filter(s => s !== 'typography' || m.allText)), applyToEach: m.applyToEach },
  };
  return (
    <DesignBarProvider value={value}>
      <div data-testid="multi-select-panel" className="p-2">
        <DesignBarHeader heading={`${m.count} element${m.count === 1 ? '' : 's'}`} />
        {/* The panel's first section (Position) carries the gap under the header. */}
        {m.count > 0 && <ElementDesignPanel design={design} />}
      </div>
    </DesignBarProvider>
  );
}
