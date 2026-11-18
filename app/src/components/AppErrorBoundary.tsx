import { Component, useEffect, useState, useRef, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate, useRouteError } from 'react-router-dom';
import { Button, OperationNotice, Row } from '@/components/ui';
import { ProjectNavigationGuard } from './ProjectNavigationGuard';
import { isStorageFailure, storageFailureGuidance } from '@/services/browserStorage';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { hasPendingUserAcceptance } from '@/services/durableEdits/acceptance';
import { downloadReleaseDiagnostics, type FailureCategory } from '@/services/releaseDiagnostics';

/** Root recovery may outlive RouterProvider, so unload protection reads the live acceptance lane. */
export function RecoveryActions({ onRetry, category = 'render', detail }: { onRetry?: () => void | Promise<void>; category?: FailureCategory; detail?: string }) {
  const [busy, setBusy] = useState(false);
  const busyOwner = useRef(false);
  const startup = category === 'startup';
  const retryLabel = startup ? 'Restart preview' : 'Try again';
  const [retryError, setRetryError] = useState(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { const id = getActiveSaveProjectId(); if (id && hasPendingUserAcceptance(id)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const retry = async () => {
    if (!onRetry || busyOwner.current) return;
    busyOwner.current = true; setBusy(true); setRetryError(false);
    try { await onRetry(); }
    catch { setRetryError(true); }
    finally { busyOwner.current = false; setBusy(false); }
  };
  return <section role="alert" className="m-4 max-w-md bg-bg text-text rounded-outer border border-stroke">
    <Row title={startup ? 'The preview could not start' : 'Starquix needs to recover'} className="pl-4 pr-2 border-b border-stroke" hover={false} />
    <div className="px-4 py-2 space-y-2">
      {detail && <div className="text-xs text-text">{detail}</div>}
      <div className="text-2xs text-text-secondary">{startup
        ? 'Your changes are stored. Use Help or download diagnostics if the preview stays unavailable.'
        : 'Your changes are stored. Try again or Reload — neither deletes project data.'}</div>
      {retryError && <OperationNotice title="Recovery could not finish." detail="Use Help or download diagnostics." />}
    </div>
    <div className="flex items-center gap-2 border-t border-stroke px-4 py-2">
      <Button variant="ghost" size="md" label="Download diagnostics" onClick={() => downloadReleaseDiagnostics({ failureCategory: category })} />
      <a href="/help.html#recovery" target="_blank" rel="noopener noreferrer" className="px-2 text-xs text-text-muted hover:text-text">Help</a>
      <div className="flex-1" />
      {!startup && <Button variant="ghost" size="md" label="Reload" onClick={() => window.location.reload()} />}
      {onRetry && <Button variant="primary" size="md" label={retryLabel} aria-label={retryLabel} loading={busy} onClick={retry} />}
    </div>
  </section>;
}
interface Props { children: ReactNode; beforeRetry?: () => void | Promise<void> }
export class AppErrorBoundary extends Component<Props, { failed: boolean; category: FailureCategory }> {
  state: { failed: boolean; category: FailureCategory } = { failed: false, category: 'render' };
  static getDerivedStateFromError(error: unknown) { return { failed: true, category: isStorageFailure(error) ? 'storage' : 'render' }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[Starquix recovery]', error, info); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <RecoveryActions category={this.state.category} onRetry={async () => { await this.props.beforeRetry?.(); this.setState({ failed: false }); }}
      detail={this.state.category === 'storage' ? storageFailureGuidance('storage', 'load') : undefined} />;
  }
}
/** Router errors replace route children, so re-install the real guard for the retained owner. */
export function RouteErrorRecovery() {
  const error = useRouteError();
  const navigate = useNavigate();
  const active = getActiveSaveProjectId();
  const owner = active && hasPendingUserAcceptance(active) ? active : null;
  useEffect(() => { console.error('[Starquix route recovery]', error); }, [error]);
  return <>
    {owner && <ProjectNavigationGuard projectId={owner} />}
    <RecoveryActions onRetry={async () => { await navigate(owner ? `/editor/${owner}` : '.', { replace: true }); }} />
  </>;
}
