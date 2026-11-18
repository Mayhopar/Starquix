import { ComponentIcon as SharedComponentIcon, EditPageIcon as SharedEditPageIcon, ShuffleIcon as SharedShuffleIcon } from '@/assets/icons';
import { type FC } from 'react';
import { Button } from '@/components/ui';
import { PullFromSourceButton, GoToSourceButton, goToSource } from './HeaderActionButtons';
import { InstanceMenu } from './InstanceMenu';

/**
 * The right-hand action cluster of the element Design header: go-to-post / swap-
 * component context buttons, plus the instance lifecycle (pull / go-to-source /
 * push-reset menu) or the drawn-element "Make component" button. Extracted from
 * DesignBar's render so the header reads as one line there.
 *
 * In the editor (isComponentEditor) there are NO lifecycle actions AND no status
 * affordance — you ARE the source (edits auto-flush into `masters`), so the
 * header right-cluster is empty.
 */
interface ElementHeaderActionsProps {
  goToPostTarget: { collection: string; slug: string } | null;
  onOpenPost: (collection: string, slug: string) => void;
  slotType?: string;
  slotComponentName?: string;
  slotKey: string | null;
  isComponentEditor: boolean;
  canResetInstance: boolean;
  /** ↻ master moved, instance not receiving it — see PullFromSourceButton. */
  showReload: boolean;
  onReset: () => void;
  isInstanceRoot: boolean;
  isBlogSlot: boolean;
  isPostRoot: boolean;
  astroSource: string | null;
  goToSourceComponentName?: string;
  isDiverged: boolean;
  isPushingToSource: boolean;
  onPush: () => void;
  canResetFromMenu: boolean;
  isDrawnElement: boolean;
  onMakeComponent: () => void;
  isMakingComponent: boolean;
  /** task-136 local mode: the user component/layout file this element lives in
   *  (source keys only) — ↗ opens its lone-component view. */
  localComponentSource?: string | null;
  /** task-149 local mode: that component carries unpushed instance edits. */
  localMasterDiverged?: boolean;
  isPushingLocalMaster?: boolean;
  /** Write this component's overrides into its real .astro file. */
  onLocalPush?: () => void;
  /** Discard them; the master file is untouched. */
  onLocalReset?: () => void;
  /** task-206 D4 (owner amendment): a SYSTEM component selection — hide
   *  ↻ / ⋮, but keep the ↗ every component has (consistency), routed to
   *  the given system master's Assets view. Present = suppress. */
  systemMaster?: { path: string; name: string };
}

export const ElementHeaderActions: FC<ElementHeaderActionsProps> = ({
  goToPostTarget, onOpenPost, slotType, slotComponentName, slotKey,
  isComponentEditor, canResetInstance, showReload, onReset,
  isInstanceRoot, isBlogSlot, isPostRoot, astroSource, goToSourceComponentName,
  isDiverged, isPushingToSource, onPush, canResetFromMenu,
  isDrawnElement, onMakeComponent, isMakingComponent,
  localComponentSource,
  localMasterDiverged = false, isPushingLocalMaster = false, onLocalPush, onLocalReset,
  systemMaster,
}) => {
  const isInstanceish = isInstanceRoot || isBlogSlot || isPostRoot;
  const noChrome = !!systemMaster;
  return (
    <>
      {/* PATH-only navigation (name omitted): LeftSidebar's handler matches by
          NAME first, and WC's built-in library carries an unrelated legacy
          `library/Media.astro` stub also named "Media" — dispatching the name
          silently opened that wrong file. By path, local resolves the real
          sq/Media.astro; WC (which has no sq/ row) no-ops instead of lying. */}
      {systemMaster && (
        <GoToSourceButton path={systemMaster.path} name={undefined} />
      )}
      {!noChrome && !isComponentEditor && localComponentSource && (
        <GoToSourceButton path={localComponentSource} name={undefined} />
      )}
      {/* task-149: local mode has no doc-managed instances, so canResetInstance
          is false and the cluster below never renders — yet the element IS an
          instance of a real component file, with the same two lifecycle actions.
          Same InstanceMenu, so the menu is identical to normal mode.
          The isComponentEditor guard is the SAME one the WC cluster uses below:
          in a master/component view you ARE the source, so no ↗ and no ⋮ —
          local's lone-component view sets it too (selectionDescriptor.ts). */}
      {/* task-184: ↻ on a local placement. Same button, same meaning ("the
          master moved past your edit"), same remedy as WC's — discard the
          overrides that are shadowing it. In local that IS onLocalReset:
          clearLocalOverrides + a preview reload, so the master's own bytes
          paint. `showReload` already carries the runtime's own gate. */}
      {!noChrome && !isComponentEditor && localComponentSource && onLocalReset && showReload && (
        <PullFromSourceButton onClick={onLocalReset} />
      )}
      {!noChrome && !isComponentEditor && localComponentSource && onLocalPush && onLocalReset && (
        <InstanceMenu
          canPush={localMasterDiverged}
          isPushing={isPushingLocalMaster}
          onPush={onLocalPush}
          canReset={localMasterDiverged}
          onReset={onLocalReset}
          onGoToSource={() => goToSource(localComponentSource, undefined)}
        />
      )}
      {goToPostTarget && (
        <Button
          variant="ghost" size="sm" iconOnly
          onClick={() => onOpenPost(goToPostTarget.collection, goToPostTarget.slug)}
          title="Go to post"
        >
          <SharedEditPageIcon className="w-4 h-4" />
        </Button>
      )}
      {slotType && slotComponentName && (
        <Button
          variant="ghost" size="sm" iconOnly
          onClick={() => {
            window.dispatchEvent(new CustomEvent('sq:open-component-picker', { detail: { slotKey } }));
          }}
          title="Swap component"
        >
          <SharedShuffleIcon className="w-4 h-4" />
        </Button>
      )}
      {noChrome || isComponentEditor ? null : canResetInstance ? (
        <>
          {showReload && <PullFromSourceButton onClick={onReset} />}
          {isInstanceish && astroSource && (
            <GoToSourceButton path={astroSource} name={goToSourceComponentName} />
          )}
          {isInstanceish && (
            <InstanceMenu
              canPush={!!(isDiverged && astroSource)}
              isPushing={isPushingToSource}
              onPush={onPush}
              canReset={canResetFromMenu}
              onReset={onReset}
              onGoToSource={() => goToSource(astroSource, goToSourceComponentName)}
            />
          )}
        </>
      ) : isDrawnElement ? (
        <Button
          variant="ghost" size="sm" iconOnly
          onClick={onMakeComponent}
          disabled={isMakingComponent}
          title="Make component"
        >
          <SharedComponentIcon className="w-4 h-4" />
        </Button>
      ) : null}
    </>
  );
};

export default ElementHeaderActions;
