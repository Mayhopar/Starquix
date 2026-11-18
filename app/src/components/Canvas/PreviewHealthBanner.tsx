import type { FC } from 'react';
import { RecoveryActions } from '@/components/AppErrorBoundary';

export type RuntimeFailureKind = 'project-unavailable';

/** Canvas owns this region only while the runtime is failed. First-document
 * setup feedback belongs to ViewportFrame after the runtime is running. */
export const PreviewHealthBanner: FC<{
  status: string;
  detail?: string | null;
  reason?: RuntimeFailureKind;
  onRetry?: () => void | Promise<void>;
}> = ({ status, reason, onRetry }) => {
  if (status !== 'error') return null;
  const copy = reason === 'project-unavailable'
    ? 'The project files could not be located. Use Help to restore access to this project.'
    : `The preview is unavailable.${onRetry ? ' Restart preview to try starting it again.' : ''}`;
  return <RecoveryActions category="startup" detail={copy} onRetry={reason ? undefined : onRetry} />;
};
