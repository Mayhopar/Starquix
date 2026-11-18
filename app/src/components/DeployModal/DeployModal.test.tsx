// The Publish window: docs/plans/2026-10-20-publish-sheet-design.md ("sheet N"); Cloudflare's guard:
// docs/plans/2026-10-16-cloudflare-one-click-design.md (ledger 38).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';

// Stub icon imports pulled in via the @/components/ui barrel (jsdom cannot use
// the SVG data-URI components). Proxy needs then→undefined + has trap.
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : Stub), has: () => true });
});
vi.mock('@/export/filesTruthZip', () => ({ assertPublishable: vi.fn(async () => {}) }));
vi.mock('@/services/durableEdits/sourceMaterialization', () => ({ awaitProjectFiles: vi.fn(async () => {}) }));
import { awaitProjectFiles as saveProject } from '@/services/durableEdits/sourceMaterialization';
import { DeployModal } from './DeployModal';
import { assertPublishable } from '@/export/filesTruthZip';
import { deploymentFailureCopy } from '@/export/operationFailure';
import { InstanceOverlayExportError } from '@/export/instanceOverlayGuard';

beforeEach(() => { vi.clearAllMocks(); });

const STATUS = { initialized: true, branch: 'main', changed: 0, files: [], merging: false, conflicts: null, remote: null, github: null,
  ahead: 0, behind: 0, user: null, host: null, pagesStale: false, pagesWorkflow: null };
const CF = { connected: true, account: { id: 'a', name: 'A' }, accounts: [], worker: null, published: false, domain: null, offline: null };
function desktopClient(over: Record<string, unknown> = {}) {
  return {
    status: vi.fn(async () => STATUS), history: vi.fn(async () => []), branches: vi.fn(async () => ['main']),
    cloudflareStatus: vi.fn(async () => CF), cloudflarePublish: vi.fn(async () => ({ wrote: false })),
    user: vi.fn(async () => null), signOut: vi.fn(async () => {}), cloudflareDisconnect: vi.fn(async () => {}),
    publishChanges: vi.fn(async () => ({ wrote: false })), typeCheck: vi.fn(async () => ({ ran: false, errors: [], total: 0 })),
    deployStatus: vi.fn(async () => ({ state: 'none', url: null, liveUrl: null, liveBranch: 'main', defaultBranch: 'main', siteBlocked: false })),
    ...over,
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;
}
function Window({ client, doc, onOpenVersions = () => {} }: { client: unknown; doc?: Y.Doc; onOpenVersions?: () => void }) {
  return <DeployModal isOpen onClose={() => {}} doc={doc ?? new Y.Doc()} projectName="p" client={client as never} onOpenVersions={onOpenVersions} />;
}

describe('DeployModal — the Publish window (S3/S4)', () => {
  it('S3/1. one window named Publish: no tabs, the destination list; Versions is another window (nothing of it is read here)', async () => {
    const client = desktopClient();
    render(<Window client={client} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Publish', { selector: 'span.text-lg' })).toBeTruthy(); // the window's name
    expect(screen.queryByRole('tab')).toBeNull();
    expect(await screen.findByRole('radiogroup', { name: 'Where your site lives' })).toBeTruthy();
    expect(client.history).not.toHaveBeenCalled();
    expect(screen.queryByText('Vercel API Token')).toBeNull(); // S2: the token form is gone
  });

  it('Cloudflare ledger 38: Publish to Cloudflare drains the journal and runs the Export guard first', async () => {
    const doc = new Y.Doc(); doc.getMap('meta').set('projectId', 'browser_p');
    render(<Window client={desktopClient()} doc={doc} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    await waitFor(() => expect(assertPublishable).toHaveBeenCalledWith('browser_p', doc));
    expect(saveProject).toHaveBeenCalledWith('browser_p');
  });

  it('Cloudflare ledger 38: a refused guard or an unsaved change → the deploy path\'s curated copy; nothing published', async () => {
    const client = desktopClient({ cloudflarePublish: vi.fn() });
    const doc = new Y.Doc(); doc.getMap('meta').set('projectId', 'browser_p');
    vi.mocked(assertPublishable).mockRejectedValueOnce(new InstanceOverlayExportError());
    vi.mocked(saveProject).mockResolvedValueOnce().mockRejectedValueOnce(new Error('IndexedDB full'));
    render(<Window client={client} doc={doc} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to Cloudflare' }));
    expect(await screen.findByText(deploymentFailureCopy('instance-overlays').title)).toBeTruthy();
    const again = await screen.findByRole('button', { name: 'Publish to Cloudflare' });
    await waitFor(() => expect(again).toBeEnabled());
    fireEvent.click(again);
    expect(await screen.findByText(deploymentFailureCopy('files').title)).toBeTruthy();
    expect(screen.queryByText("That didn't work.")).toBeNull();
    expect(screen.queryByText('IndexedDB full')).toBeNull();
    expect(client.cloudflarePublish).not.toHaveBeenCalled();
  });

  it('5. the header is the name only (no ⋯, no ✕ — the owner\'s Figma 2026-10-21/22); the account is in the picked destination: Log out → re-read → Log in; Cancel closes', async () => {
    const onClose = vi.fn();
    let user: { login: string } | null = { login: 'oleg' };
    const client = desktopClient({ status: vi.fn(async () => ({ ...STATUS, user, remote: 'https://github.com/oleg/site.git', github: { owner: 'oleg', repo: 'site' }, host: 'netlify' })),
      signOut: vi.fn(async () => { user = null; }) });
    render(<DeployModal isOpen onClose={onClose} doc={new Y.Doc()} projectName="p" client={client as never} onOpenVersions={() => {}} />);
    await screen.findByRole('radiogroup', { name: 'Where your site lives' });
    expect(screen.queryByRole('button', { name: 'Accounts' })).toBeNull();
    expect(await screen.findByDisplayValue('oleg')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(client.signOut).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy(); // the sheet re-read
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); // the footer's Cancel, next to Publish
    expect(onClose).toHaveBeenCalled();
  });

  it('a window still loading can be left: its footer is already Cancel + Publish (disabled) — nothing jumps when it loads', async () => {
    const onClose = vi.fn();
    render(<DeployModal isOpen onClose={onClose} doc={new Y.Doc()} projectName="p" client={desktopClient({ status: vi.fn(() => new Promise(() => {})) }) as never}
      onOpenVersions={() => {}} />);
    expect(await screen.findByRole('status', { name: 'Loading destinations' })).toBeTruthy();
    const placeholder = screen.getByText('Publish', { selector: 'button' }); // a placeholder, like the skeleton rows
    expect(placeholder).toBeDisabled();
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('9. one op at a time: while Publish runs the list and the account wait', async () => {
    let release!: () => void;
    const client = desktopClient({
      status: vi.fn(async () => ({ ...STATUS, changed: 1, user: { login: 'oleg' }, remote: 'https://github.com/oleg/site.git', github: { owner: 'oleg', repo: 'site' }, host: 'netlify' })),
      publishChanges: vi.fn(() => new Promise(r => { release = () => r({ wrote: false }); })) });
    render(<Window client={client} />);
    const publish = await screen.findByRole('button', { name: 'Publish' });
    await waitFor(() => expect(publish).toBeEnabled());
    fireEvent.click(publish);
    await waitFor(() => expect(client.publishChanges).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Log out' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Cloudflare' })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log out' })).toBeEnabled());
  });

  it('8. "Resolve in Versions" asks the editor to swap this window for Versions', async () => {
    const onOpenVersions = vi.fn();
    const client = desktopClient({ status: vi.fn(async () => ({ ...STATUS, merging: true, user: { login: 'oleg' }, remote: 'https://github.com/oleg/site.git',
      github: { owner: 'oleg', repo: 'site' }, host: 'netlify' })) });
    render(<Window client={client} onOpenVersions={onOpenVersions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve in Versions' }));
    expect(onOpenVersions).toHaveBeenCalled();
  });
});
