// export_project (zip of the project rows) + confirm-gated deploy_project (Vercel only).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { generateCommandTools } from '../commandTools';
import { commandRegistry } from '../commandRegistry';
import { deployToVercel } from '@/export';
import { downloadFilesTruthZip, projectFilesAsArtifacts } from '@/export/filesTruthZip';
import { awaitProjectFiles } from '@/services/durableEdits/sourceMaterialization';
import { getToken } from '@/utils/deployTokens';
import { makeCtx, type ExecTool } from './testCtx';

vi.mock('@/export', () => ({
  deployToVercel: vi.fn(async () => ({ url: 'https://proj.vercel.app' })),
}));
vi.mock('@/export/filesTruthZip', () => ({
  downloadFilesTruthZip: vi.fn(async () => undefined),
  projectFilesAsArtifacts: vi.fn(async () => ({
    files: [{ path: 'package.json', content: '{}' }, { path: 'src/pages/index.astro', content: '---\n---' }],
    binaries: [],
    projectName: 'proj',
  })),
}));
vi.mock('@/services/durableEdits/sourceMaterialization', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  awaitProjectFiles: vi.fn(async () => undefined),
}));
vi.mock('@/utils/deployTokens', () => ({
  getToken: vi.fn(() => null),
}));

function projectDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', 'browser_p');
  doc.getMap('meta').set('projectName', 'proj');
  return doc;
}

beforeEach(() => {
  vi.mocked(downloadFilesTruthZip).mockClear();
  vi.mocked(projectFilesAsArtifacts).mockClear();
  vi.mocked(awaitProjectFiles).mockClear();
  vi.mocked(deployToVercel).mockClear();
  vi.mocked(getToken).mockReset();
  vi.mocked(getToken).mockReturnValue(null);
});

describe('export_project', () => {
  it('drains pending writes, then downloads a zip of the project rows, no snapshot', async () => {
    const ctx = makeCtx({ doc: projectDoc() });
    const r = await (generateCommandTools(ctx).export_project as ExecTool).execute({});
    expect(awaitProjectFiles).toHaveBeenCalledWith('browser_p', { agent: true }); // an AI tool never commits the user's typed draft
    expect(downloadFilesTruthZip).toHaveBeenCalledWith('browser_p', 'proj', expect.anything());
    expect(vi.mocked(awaitProjectFiles).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(downloadFilesTruthZip).mock.invocationCallOrder[0]);
    expect(ctx.takeSnapshot).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
  });

  it('reports failure when the zip cannot be built', async () => {
    vi.mocked(downloadFilesTruthZip).mockRejectedValueOnce(new Error('no project files'));
    const r = await (generateCommandTools(makeCtx({ doc: projectDoc() })).export_project as ExecTool).execute({});
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/no project files/);
  });
});

describe('deploy_project', () => {
  // Owner 2026-11-10: never a popup. A public deploy can't be undone, so the agent asks the user in its reply.
  it('without confirm:true it deploys nothing and asks for the OK — never a popup', async () => {
    const native = vi.spyOn(window, 'confirm');
    const r = await (generateCommandTools(makeCtx({ doc: projectDoc() })).deploy_project as ExecTool).execute({ provider: 'vercel' });
    expect(deployToVercel).not.toHaveBeenCalled();
    expect(r).toMatchObject({ success: false, cancelled: true, needsConfirmation: true });
    expect(native).not.toHaveBeenCalled();
  });

  it('fails with a helpful message when no token is stored', async () => {
    const r = await (generateCommandTools(makeCtx({ doc: projectDoc() })).deploy_project as ExecTool).execute({ provider: 'vercel', confirm: true });
    expect(deployToVercel).not.toHaveBeenCalled();
    expect(projectFilesAsArtifacts).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/Publish window/);
    vi.unstubAllGlobals();
  });

  it('deploys the project rows to vercel and returns the URL when the user said yes (confirm:true) with a token', async () => {
    vi.mocked(getToken).mockReturnValue('tok-123');
    const ctx = makeCtx({ doc: projectDoc() });
    const r = await (generateCommandTools(ctx).deploy_project as ExecTool).execute({ provider: 'vercel', confirm: true });
    expect(awaitProjectFiles).toHaveBeenCalledWith('browser_p', { agent: true }); // an AI tool never commits the user's typed draft
    expect(projectFilesAsArtifacts).toHaveBeenCalledWith('browser_p', 'proj', expect.anything());
    expect(deployToVercel).toHaveBeenCalledWith(expect.objectContaining({
      token: 'tok-123', projectName: 'proj',
      files: [{ path: 'package.json', content: '{}' }, { path: 'src/pages/index.astro', content: '---\n---' }],
      binaries: [],
    }));
    expect(ctx.takeSnapshot).not.toHaveBeenCalled();
    expect(r.success).toBe(true);
    expect(r.data?.url).toBe('https://proj.vercel.app');
    vi.unstubAllGlobals();
  });

  it('only accepts vercel as a provider (netlify was removed)', () => {
    const schema = commandRegistry.deploy_project.schema;
    expect(schema.safeParse({ provider: 'vercel' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ provider: 'netlify' }).success).toBe(false);
  });
});
