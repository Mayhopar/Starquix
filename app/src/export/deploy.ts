// src/export/deploy.ts
import type { ExportFile, BinaryExportFile } from './types';

function sanitizeVercelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'my-project';
}

export async function deployToVercel(opts: {
  files: ExportFile[];
  binaries?: BinaryExportFile[];
  token: string;
  projectName: string;
}): Promise<{ url: string; deploymentId: string }> {
  const authHeaders = { Authorization: `Bearer ${opts.token}` };

  // Team-scoped tokens 403 ("forbidden … fileUpload") on the personal
  // namespace; on the first 403 we resolve the token's team once and append
  // ?teamId= to every subsequent call. ponytail: first team wins — good enough
  // until someone deploys with a token spanning multiple teams.
  let teamQuery = '';
  let teamQueryP: Promise<void> | null = null;
  const resolveTeamQuery = () =>
    (teamQueryP ??= (async () => {
      const res = await fetch('https://api.vercel.com/v2/teams?limit=1', { headers: authHeaders });
      const teams = res.ok ? (await res.json()).teams : [];
      teamQuery = teams?.[0]?.id ? `?teamId=${teams[0].id}` : '';
    })());

  // Step 1: Upload each artifact and compute SHA1.
  // Text + binary artifacts go through the identical SHA-1 + upload loop.
  // Binary data is copied so fetch/digest get plain ArrayBuffer-backed views.
  const entries: { path: string; bytes: Uint8Array<ArrayBuffer> }[] = [
    ...opts.files.map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.content) })),
    ...(opts.binaries ?? []).map((b) => ({ path: b.path, bytes: new Uint8Array(b.data) })),
  ];

  // Uploads are independent — bounded concurrency instead of one serial
  // round-trip per artifact (the artifact set now includes binaries, mirrored
  // content and theme files). Chunked Promise.all keeps manifest order.
  const UPLOAD_CONCURRENCY = 6;
  const uploadedFiles: { file: string; sha: string; size: number }[] = [];

  const uploadOne = async ({ path, bytes }: { path: string; bytes: Uint8Array<ArrayBuffer> }) => {
    const hashBuffer = await crypto.subtle.digest('SHA-1', bytes);
    const sha = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const postFile = () =>
      fetch(`https://api.vercel.com/v2/files${teamQuery}`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/octet-stream',
          'x-vercel-digest': sha,
        },
        body: bytes,
      });

    let uploadRes = await postFile();
    if (uploadRes.status === 403) {
      await resolveTeamQuery();
      if (teamQuery) uploadRes = await postFile();
    }

    // 200 = uploaded, 409 = already exists — both fine
    if (!uploadRes.ok && uploadRes.status !== 409) {
      throw new Error(`Vercel file upload failed for ${path}: ${await uploadRes.text()}`);
    }

    return { file: path, sha, size: bytes.length };
  };

  for (let i = 0; i < entries.length; i += UPLOAD_CONCURRENCY) {
    const chunk = entries.slice(i, i + UPLOAD_CONCURRENCY);
    uploadedFiles.push(...(await Promise.all(chunk.map(uploadOne))));
  }

  // Step 2: Create deployment. Same 403→teamId retry as uploads — a redeploy
  // where every file POST returns 409 (already uploaded) reaches this point
  // with teamQuery still unresolved.
  const postDeployment = () =>
    fetch(`https://api.vercel.com/v13/deployments${teamQuery}`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sanitizeVercelName(opts.projectName),
        files: uploadedFiles,
        projectSettings: { framework: 'astro' },
      }),
    });

  let deployRes = await postDeployment();
  if (deployRes.status === 403 && !teamQuery) {
    await resolveTeamQuery();
    if (teamQuery) deployRes = await postDeployment();
  }

  if (!deployRes.ok) throw new Error(`Vercel deployment failed: ${await deployRes.text()}`);

  const deployment = await deployRes.json();
  return {
    url: `https://${deployment.url}`,
    deploymentId: deployment.id,
  };
}
