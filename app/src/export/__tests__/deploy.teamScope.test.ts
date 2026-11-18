// Regression: team-scoped Vercel tokens 403 on /v2/files without ?teamId=.
// deployToVercel must resolve the team once and retry uploads + deployment
// with teamId appended.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { deployToVercel } from '../deploy';

describe('deployToVercel — team-scoped token fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retries uploads with ?teamId= after 403 and deploys with teamId', async () => {
    if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', webcrypto);

    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('/v2/teams')) {
        return { ok: true, json: async () => ({ teams: [{ id: 'team_abc' }] }) };
      }
      if (url.includes('/v2/files')) {
        const hasTeam = url.includes('teamId=team_abc');
        return {
          ok: hasTeam,
          status: hasTeam ? 200 : 403,
          text: async () => (hasTeam ? '' : '{"error":{"code":"forbidden"}}'),
        };
      }
      if (url.includes('/v13/deployments')) {
        expect(url).toContain('teamId=team_abc');
        return { ok: true, json: async () => ({ url: 'x.vercel.app', id: 'dep_1' }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const result = await deployToVercel({
      files: [
        { path: 'package.json', content: '{}' },
        { path: 'index.html', content: '<html/>' },
      ],
      token: 't',
      projectName: 'p',
    });

    expect(result.url).toBe('https://x.vercel.app');
    // teams resolved exactly once despite concurrent uploads
    expect(calls.filter((u) => u.includes('/v2/teams'))).toHaveLength(1);
    // every upload eventually succeeded via the teamId retry
    expect(calls.filter((u) => u.includes('/v2/files') && u.includes('teamId=team_abc'))).toHaveLength(2);
  });

  it('personal token (no teams) surfaces the original 403', async () => {
    if (!globalThis.crypto?.subtle) vi.stubGlobal('crypto', webcrypto);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v2/teams')) return { ok: true, json: async () => ({ teams: [] }) };
      return { ok: false, status: 403, text: async () => 'forbidden' };
    }));

    await expect(
      deployToVercel({ files: [{ path: 'a', content: 'x' }], token: 't', projectName: 'p' })
    ).rejects.toThrow(/file upload failed/);
  });
});
