import type { IssueCopy } from '@/utils/operationIssue';
import { InstanceOverlayExportError, INSTANCE_OVERLAY_EXPORT_MESSAGE } from './instanceOverlayGuard';

export type DeployFailureStage = 'files' | 'prepare' | 'build' | 'upload' | 'instance-overlays';
const deploymentFailures: Record<DeployFailureStage, IssueCopy> = {
  'instance-overlays': { title: INSTANCE_OVERLAY_EXPORT_MESSAGE },
  files: { title: 'Deployment could not start because a change has not reached the project files yet.', detail: 'No deployment was sent. Wait for the preview to catch up, then try again.' },
  prepare: { title: 'The project files could not be prepared for deployment.', detail: 'No deployment was sent. The project remains open.' },
  build: { title: 'The project could not be built for deployment.', detail: 'No deployment was sent. Check that the project can build before trying again.' },
  upload: { title: 'Deployment has not been confirmed.', detail: 'Check your provider’s deployments before trying again to avoid creating a duplicate.' },
};
export function deploymentFailureCopy(stage: DeployFailureStage): IssueCopy {
  return deploymentFailures[stage];
}

export class ExportActionError extends Error {
  constructor(readonly stage: 'files' | 'archive', readonly cause: unknown) {
    super(cause instanceof InstanceOverlayExportError ? cause.message : stage === 'files'
      ? 'Export could not start because a change has not reached the project files yet.'
      : 'The project archive could not be prepared.');
    this.name = 'ExportActionError';
  }
}
export function exportFailureMessage(error: unknown): string {
  if (error instanceof InstanceOverlayExportError || (error instanceof ExportActionError && error.cause instanceof InstanceOverlayExportError)) return INSTANCE_OVERLAY_EXPORT_MESSAGE;
  return error instanceof ExportActionError
    ? error.stage === 'files'
      ? 'Export could not start because a change has not reached the project files yet.'
      : 'The project archive could not be prepared.'
    : 'The project could not be exported.';
}
