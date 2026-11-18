/**
 * ElementDesignPanel — the style stack for one concrete selected element
 * (Position · Appearance · Layout · Link · Typography · Image · Fill · Stroke ·
 * Effects). Extracted verbatim from DesignBar.tsx (task-043) to shrink the god
 * component. Behavior-preserving: same JSX, same conditionals, same per-block
 * BlockErrorBoundary granularity.
 *
 * Receives ONE `design` bundle (all fields required — no silent optionals; a
 * default we did not choose is a bug, ledger #15) and reads the selection
 * `descriptor` from DesignBarContext. The bundle is recreated each render in
 * DesignBar (NOT memoized, ledger #17) to match the old inline JSX's re-render
 * semantics exactly. `handleClassesChange`/`pendingStorageRef` stay in DesignBar
 * (ledger #18); the panel only calls the passed handler.
 */
import type { ComputedStyles } from '../../context/SelectionContext';
import { useSelectedElement } from '../../context/SelectionContext';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { Button } from '@/components/ui';
import { useDesignBarContext } from './DesignBarContext';
import { ExpandableRow, OptionalSection, EffectsSection } from './sections';
import { BlockErrorBoundary } from './BlockErrorBoundary';
import { BlockOverridePills, BLOCK_PATTERNS } from './BlockOverridePills';
import { ContentFieldPickerPair } from './inputs/ContentFieldPickerPair';
import { PositionBlock } from './blocks/PositionBlock';
import { AppearanceBlock } from './blocks/AppearanceBlock';
import { LayoutAppearanceBlock } from './blocks/LayoutAppearanceBlock';
import { SpacingBlock } from './blocks/SpacingBlock';
import { LinkBlock } from './blocks/LinkBlock';
import { TypographyBlock } from './blocks/TypographyBlock';
import { VideoBlock } from './blocks/VideoBlock';
import { FillBlock } from './blocks/FillBlock';
import { PenStyleBlock } from './blocks/PenStyleBlock';
import { StrokeBlock } from './blocks/StrokeBlock';
import { EffectsBlock } from './blocks/EffectsBlock';
import { MultiFillControls } from './multi/MultiFillControls';
import type { Owns } from './multi/mixed';

/** Sections a multi-selection can show (multi/MultiDesignPanel MULTI_READY). */
export type MultiSection = 'position' | 'appearance' | 'layout' | 'spacing' | 'typography' | 'fill' | 'stroke' | 'effects';

export interface ElementDesignBundle {
  key: string | null;
  fillVariant?: string;
  getCurrentClasses?: () => string;
  currentClasses: string;
  fullClasses: string;
  /** `owns` = the tokens this write owns; only they change on each member while ≥2 are selected (multi/mixed.ts). */
  handleClassesChange: (newBlockClasses: string, owns?: Owns) => void;
  deletePrefixClasses: (prefix: string, blockPattern: RegExp) => void;
  computedStyles: ComputedStyles | null;
  // element-kind flags (derived in DesignBar; descriptor.effectiveTagName read
  // from context — see ledger tension #2)
  isTextElement: boolean;
  isImageElement: boolean;
  isVideoElement: boolean;
  /** Element with a penPath (pen tool OR any shape tool, task-109) — shows the fill/stroke path-style block. */
  hasPenPath: boolean;
  isEditingText: boolean;
  isGridChild: boolean;
  parentGridInfo: { cols: number; rows: number; sizeIsExact: boolean };
  gridCell: { colStart: number; colSpan: number; rowStart: number; rowSpan: number } | null;
  /** Grid-child placement lives on the canvas's breakpoint layer (see LayoutAppearanceBlock). */
  placementClasses?: string;
  handleGridPlacementChange?: (axis: 'col' | 'row', tokens: string[], stripsFixedSize: boolean) => void;
  handleGridTemplateChange?: (axis: 'col' | 'row', count: number | null) => void;
  // picker embeds
  isInsideBlogSlot: boolean;
  blogSlotKey: string | null;
  showPostPicker: boolean;
  postPageSlotKey: string | null;
  // section toggles
  hasFillClasses: boolean;
  handleAddFill: () => void;
  handleRemoveFill: () => void;
  hasStrokeClasses: boolean;
  handleAddStroke: () => void;
  handleRemoveStroke: () => void;
  hasEffectsClasses: boolean;
  handleAddEffects: () => void;
  // link / image
  showLinkBlock: boolean;
  handleLinkChange: (href: string) => void;
  handleUnlink: () => void;
  setLinkInteracting: (value: boolean) => void;
  imageSrc: string | null;
  imageAlt: string | null;
  imagePreviewDataUrl: string | null;
  /** Static inline <svg> instance child: convert it to an editable pen shape. Null hides the action. */
  onConvertSvgToShape: (() => void) | null;
  /** Set while ≥2 are selected (multi/MultiDesignPanel): only these sections render, Fill is
   *  MultiFillControls (its gradient switch transforms each member in ONE batch: applyToEach), no
   *  override pills or picker embeds (design C3, C4). */
  multi?: { sections: ReadonlySet<MultiSection>; applyToEach: (transform: (effective: string[]) => string[]) => void };
}

/**
 * task-144: Fill renders for EVERY element in EVERY runtime — its Media tab
 * is THE image surface (the legacy ImageBlock UI is retired; FillBlock
 * branches per selection type/runtime internally). Signature kept so the
 * gate stays pinned by tests if a runtime split ever tries to come back.
 */
export function shouldShowFillSection(_opts: {
  isImageElement: boolean;
  isLocalProject: boolean;
  hasSourceLocation: boolean;
  tagName: string | null;
  /** task-142: astro <Image> bound asset — Fill Media is the swap surface */
  hasBoundAsset?: boolean;
}): boolean {
  return true;
}

export default function ElementDesignPanel({ design }: { design: ElementDesignBundle }) {
  const {
    key, currentClasses, fullClasses, handleClassesChange, deletePrefixClasses, computedStyles,
    isTextElement, isImageElement, isVideoElement, imageSrc, hasPenPath, isEditingText, isGridChild, parentGridInfo, gridCell,
    placementClasses, handleGridPlacementChange, handleGridTemplateChange,
    isInsideBlogSlot, blogSlotKey, showPostPicker, postPageSlotKey,
    hasFillClasses, handleAddFill, handleRemoveFill,
    hasStrokeClasses, handleAddStroke, handleRemoveStroke,
    hasEffectsClasses, handleAddEffects,
    showLinkBlock, handleLinkChange, handleUnlink, setLinkInteracting,
    onConvertSvgToShape,
  } = design;
  // effectiveTagName comes from the selection descriptor (ledger tension #2 —
  // descriptor exposes the tag, the derived kind bools live in the bundle).
  const { effectiveTagName } = useDesignBarContext()!.descriptor;
  const multi = design.multi?.sections;
  const show = (section: MultiSection) => !multi || multi.has(section);
  /** Override pills are per element — hidden while ≥2 are selected (C4). */
  const pills = (pattern: RegExp) => multi ? undefined : <BlockOverridePills classes={fullClasses} blockPattern={pattern} onDeletePrefix={deletePrefixClasses} />;

  // task-141: local-mode resolved media (img/video source element) keeps Fill.
  const isLocalProject = !!useLocalProjectPath();
  const { sourceLocation: selectedSourceLocation, boundAssetPath } = useSelectedElement();
  const showFill = shouldShowFillSection({
    isImageElement,
    isLocalProject,
    hasSourceLocation: !!selectedSourceLocation,
    tagName: effectiveTagName ?? null,
    hasBoundAsset: !!boundAssetPath,
  });
  const fillTags = pills(BLOCK_PATTERNS.fill);
  const fillBlock = (
    <BlockErrorBoundary blockName="Fill" resetKey={key}>
      {design.multi ? <MultiFillControls classes={currentClasses} onClassesChange={handleClassesChange} applyToEach={design.multi.applyToEach} /> : <FillBlock
        classes={currentClasses}
        onClassesChange={handleClassesChange}
        computedStyles={computedStyles}
        variant={design.fillVariant}
        getCurrentClasses={design.getCurrentClasses}
        computedBackgroundImage={computedStyles?.backgroundImage}
        bgImagePreviewDataUrl={computedStyles?.bgImagePreviewDataUrl}
      />}
    </BlockErrorBoundary>
  );
  return (
    <>
      {/* 0. Static svg → editable pen shape (node editing lives in the pen system) */}
      {onConvertSvgToShape && (
        <div className="px-2 mt-2">
          <Button
            variant="secondary"
            size="sm"
            label="Convert to editable shape"
            className="w-full"
            onClick={onConvertSvgToShape}
          />
        </div>
      )}

      {/* 1. Position */}
      {show('position') && <ExpandableRow title="Position" className="mt-2" defaultExpanded={false} tags={pills(BLOCK_PATTERNS.position)}>
        <BlockErrorBoundary blockName="Position" resetKey={key}>
          <PositionBlock
            classes={currentClasses}
            onClassesChange={handleClassesChange}
          />
        </BlockErrorBoundary>
      </ExpandableRow>}

      {/* 2. Appearance */}
      {show('appearance') && <ExpandableRow title="Appearance" defaultExpanded={false} tags={pills(BLOCK_PATTERNS.appearance)}>
        <BlockErrorBoundary blockName="Appearance" resetKey={key}>
          {!multi && <ContentFieldPickerPair
            elementKey={key} filterTypes={['image']} autoFieldType="image" enabled={isImageElement}
            isInsideBlogSlot={isInsideBlogSlot} blogSlotKey={blogSlotKey}
            showPostPicker={showPostPicker} postPageSlotKey={postPageSlotKey}
          />}
          <AppearanceBlock
            classes={currentClasses}
            onClassesChange={handleClassesChange}
          />
        </BlockErrorBoundary>
      </ExpandableRow>}

      {/* 3. Layout & Size (combined) - collapsed by default for text elements */}
      {(show('layout') || show('spacing')) && <ExpandableRow title="Layout" defaultExpanded={!isTextElement} tags={pills(BLOCK_PATTERNS.layout)}>
        <BlockErrorBoundary blockName="Layout" resetKey={key}>
          <>
            {show('layout') && <LayoutAppearanceBlock
              classes={currentClasses}
              onClassesChange={handleClassesChange}
              isGridChild={isGridChild}
              parentGridCols={parentGridInfo.cols}
              parentGridRows={parentGridInfo.rows}
              parentGridSizeIsExact={parentGridInfo.sizeIsExact}
              gridCell={gridCell}
              placementClasses={placementClasses}
              onPlacementChange={handleGridPlacementChange}
              onGridTemplateChange={handleGridTemplateChange}
            />}
            {/* Spacing (Margin & Padding) */}
            {show('spacing') && <SpacingBlock
              classes={currentClasses}
              onClassesChange={handleClassesChange}
            />}
          </>
        </BlockErrorBoundary>
      </ExpandableRow>}

      {/* 4. Link (the selected element's, or the text session's) */}
      {showLinkBlock && (
        <BlockErrorBoundary blockName="Link" resetKey={key}>
          <ContentFieldPickerPair
            elementKey={key} filterTypes={['url']} autoFieldType="url"
            isInsideBlogSlot={isInsideBlogSlot} blogSlotKey={blogSlotKey}
            showPostPicker={showPostPicker} postPageSlotKey={postPageSlotKey}
            enabled={effectiveTagName === 'a'}
          />
          <LinkBlock
            elementKey={key}
            isEditingText={isEditingText}
            onLinkChange={handleLinkChange}
            onUnlink={handleUnlink}
            onInteractingChange={setLinkInteracting}
          />
        </BlockErrorBoundary>
      )}

      {/* 5. Typography (only for text elements; in multi only when EVERY member is text — C3) */}
      {isTextElement && show('typography') && (
        <ExpandableRow title="Typography" tags={pills(BLOCK_PATTERNS.typography)}>
          <BlockErrorBoundary blockName="Typography" resetKey={key}>
            {!multi && <ContentFieldPickerPair
              elementKey={key} filterTypes={['text', 'date']} autoFieldType="text"
              isInsideBlogSlot={isInsideBlogSlot} blogSlotKey={blogSlotKey}
              showPostPicker={showPostPicker} postPageSlotKey={postPageSlotKey}
            />}
            <TypographyBlock
              elementKey={key}
              classes={currentClasses}
              computedStyles={computedStyles}
              onClassesChange={handleClassesChange}
            />
          </BlockErrorBoundary>
        </ExpandableRow>
      )}

      {/* 6. (task-144) The legacy Image block is retired — Fill's Media tab
          is the ONE image surface in every runtime. */}

      {/* 6a. Video (for <video> elements) */}
      {isVideoElement && (
        <ExpandableRow title="Video">
          <BlockErrorBoundary blockName="Video" resetKey={key}>
            <VideoBlock
              elementKey={key}
              videoSrc={imageSrc}
              classes={currentClasses}
              onClassesChange={handleClassesChange}
            />
          </BlockErrorBoundary>
        </ExpandableRow>
      )}

      {/* 6b. Path style (penPath elements: fill/stroke inherit into the inner SVG) */}
      {hasPenPath && (
        <ExpandableRow title="Path" defaultExpanded>
          <BlockErrorBoundary blockName="Path" resetKey={key}>
            <PenStyleBlock
              classes={currentClasses}
              onClassesChange={handleClassesChange}
            />
          </BlockErrorBoundary>
        </ExpandableRow>
      )}

      {/* 7. Fill — for an img/video the section is forced open: the Media tab is
          the one image surface (task-144) and holds its Delete. Any other
          element gets Stroke's +/– (owner 2026-10-18: a fill must be removable). */}
      {showFill && show('fill') && (isImageElement || isVideoElement
        ? <ExpandableRow title="Fill" defaultExpanded tags={fillTags}>{fillBlock}</ExpandableRow>
        : <OptionalSection title="Fill" hasClasses={hasFillClasses} onAdd={handleAddFill} onRemove={handleRemoveFill} tags={fillTags}>{fillBlock}</OptionalSection>)}

      {/* 8. Stroke */}
      {show('stroke') && <OptionalSection
        title="Stroke"
        hasClasses={hasStrokeClasses}
        onAdd={handleAddStroke}
        onRemove={handleRemoveStroke}
        tags={pills(BLOCK_PATTERNS.stroke)}
      >
        <BlockErrorBoundary blockName="Stroke" resetKey={key}>
          <StrokeBlock
            classes={currentClasses}
            onClassesChange={handleClassesChange}
          />
        </BlockErrorBoundary>
      </OptionalSection>}

      {/* 9. Effects */}
      {show('effects') && <EffectsSection
        title="Effects"
        hasEffects={hasEffectsClasses}
        onAdd={handleAddEffects}
        tags={pills(BLOCK_PATTERNS.effects)}
      >
        <BlockErrorBoundary blockName="Effects" resetKey={key}>
          <EffectsBlock
            classes={currentClasses}
            fullClasses={fullClasses}
            onClassesChange={handleClassesChange}
          />
        </BlockErrorBoundary>
      </EffectsSection>}
    </>
  );
}
