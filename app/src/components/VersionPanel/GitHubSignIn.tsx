/**
 * GitHub device-flow sign-in (D2), shared by Versions and Publish: Sign in with GitHub → the code + Open GitHub + Cancel in the
 * same place; errors in a notice (docs/plans/2026-10-14-github-publish-design.md cases 7–10). Versions draws it as one row;
 * Publish (`labeled`) as a window form item — "GitHub" on top, Log in (docs/plans/2026-10-21-publish-figma-ledger.md).
 * Signed out, a window's decision (Publish, Back up) is disabled until GitHub is reached, so Log in — then Open GitHub — is the
 * window's one live primary (owner 2026-10-22: "login github button must be primary when not logged").
 */
import { useState } from 'react';
import { Button, Field, InputGroup, Labeled, OperationNotice, Row } from '@/components/ui';
import { parseGitError, type GitClient, type GitError } from '@/services/git/gitClient';
import { CONTROL_ROW, open } from '@/components/DeployModal/publishParts';

const COPY: Partial<Record<GitError['code'], { title: string; detail?: string }>> = {
  'not-configured': { title: "GitHub sign-in isn't set up in this build." },
  'no-keychain': { title: 'No system keychain to keep the GitHub sign-in.' },
  denied: { title: 'GitHub sign-in was denied.' },
  expired: { title: 'The sign-in code expired.' },
  offline: { title: "You're offline." },
};
/** Retrying cannot help these. */
const FINAL = new Set<GitError['code']>(['not-configured', 'no-keychain']);

interface Props { client: GitClient; onSignedIn: () => void; labeled?: boolean }

export function GitHubSignIn({ client, onSignedIn, labeled = false }: Props) {
  const [device, setDevice] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [error, setError] = useState<GitError | null>(null);

  async function signIn() {
    setError(null);
    try {
      setDevice(await client.signIn());
      await client.signInWait();
      setDevice(null); onSignedIn();
    } catch (e) {
      setDevice(null);
      const g = parseGitError(e);
      if (g.code !== 'cancelled') setError(g);
    }
  }

  const notice = error && (
    <OperationNotice {...(COPY[error.code] ?? { title: "That didn't work.", detail: error.message })}
      action={FINAL.has(error.code) ? undefined : { label: 'Try again', onClick: () => void signIn() }} />
  );
  if (labeled) return (
    <>
      <Labeled label="GitHub" caption={device ? 'Enter this code on GitHub' : null} role={device ? 'status' : undefined}>
        <InputGroup layout="row" gap={2}>
          {device ? (<>
            <Field size="lg" readOnly mono value={device.userCode} onChange={() => {}} aria-label="GitHub code" className="flex-1" />
            <Button variant="primary" size="md" label="Open GitHub" onClick={() => open(device.verificationUri)} />
            <Button variant="ghost" size="md" label="Cancel" onClick={() => void client.signInCancel()} />
          </>) : <Button variant="primary" size="md" label="Log in" onClick={() => void signIn()} />}
        </InputGroup>
      </Labeled>
      {notice}
    </>
  );
  if (device) return (
    <div role="status">
      <Row size="sm" className={CONTROL_ROW} hover={false} title="Enter this code on GitHub"
        right={[{ type: 'custom', unboxed: true, node: (
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs text-text select-all mr-1" data-testid="device-code">{device.userCode}</span>
            <Button variant="ghost" size="sm" label="Open GitHub" onClick={() => open(device.verificationUri)} />
            <Button variant="ghost" size="sm" label="Cancel" onClick={() => void client.signInCancel()} />
          </div>) }]} />
    </div>
  );
  return (
    <>
      <Row size="sm" className={CONTROL_ROW} hover={false} title="GitHub"
        right={[{ type: 'custom', unboxed: true, node: <Button variant="secondary" size="sm" label="Sign in with GitHub" onClick={() => void signIn()} /> }]} />
      {notice && <div className="pt-2">{notice}</div>}
    </>
  );
}
