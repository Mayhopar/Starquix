// src/components/DeployModal/DeployModal.tsx
/**
 * The Publish window (desktop, docs/plans/2026-10-20-publish-sheet-design.md S3/S4, drawn as the owner's Figma —
 * docs/plans/2026-10-21-publish-figma-ledger.md): one sheet (PublishFlow) — the destination list, the picked destination's
 * items under its row (its account among them: Log in / Log out), one footer. Versions is its own window
 * (VersionPanel.VersionsWindow); a notice's "Open Versions" swaps them.
 */
import { awaitProjectFiles } from '@/services/durableEdits/sourceMaterialization';
import { useCallback } from 'react';
import { GitError, type GitClient } from '@/services/git/gitClient';
import { PublishFlow } from './PublishFlow';
import { Window } from './publishParts';
import { assertPublishable } from '@/export/filesTruthZip';
import { selectProjectId } from '@/store/selectors';
import type * as Y from 'yjs';
import { deploymentFailureCopy, type DeployFailureStage } from '@/export/operationFailure';
import { InstanceOverlayExportError } from '@/export/instanceOverlayGuard';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  doc: Y.Doc;
  projectName: string;
  client: GitClient;
  /** Swaps this window for Versions (merges, branches). */
  onOpenVersions: () => void;
}

export function DeployModal({ isOpen, onClose, doc, projectName, client, onOpenVersions }: Props) {
  /** Publish to Cloudflare builds the folder on disk in main: drain the journal, then the Export guard
   *  (docs/plans/2026-10-16-cloudflare-one-click-design.md, ledger 38). A refusal carries the deploy path's curated copy. */
  const cloudflareCheck = useCallback(async () => {
    const projectId = selectProjectId(doc) ?? '';
    let stage: DeployFailureStage = 'files';
    try {
      await awaitProjectFiles(projectId);
      stage = 'prepare';
      await assertPublishable(projectId, doc);
    } catch (err) {
      const copy = deploymentFailureCopy(err instanceof InstanceOverlayExportError ? 'instance-overlays' : stage);
      throw new GitError('refused', copy.title, { detail: copy.detail });
    }
  }, [doc]);

  return (
    <Window isOpen={isOpen} onClose={onClose} title="Publish">
      <PublishFlow client={client} projectName={projectName} check={cloudflareCheck} onOpenVersions={onOpenVersions} active={isOpen} />
    </Window>
  );
}
