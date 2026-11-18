// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { localFetch } from '@/utils/sqLocalBase';

let runtime: ReturnType<typeof projectFsRuntime>;
afterEach(() => runtime?.close());
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
async function send(file: string, beforeSource: string | null, afterSource: string) {
  const response = await localFetch('/__sq/local/source-command', { method: 'POST', body: JSON.stringify({
    projectId: 'folder-route', path: 'wc://folder-route', commandId: 'folder-command', commandDigest: hash('folder-command'),
    files: [{ file, beforeSource, afterSource, beforeHash: hash(JSON.stringify(beforeSource)), afterHash: hash(JSON.stringify(afterSource)) }],
  }) });
  return { response, result: await response.json() };
}
it('conditionally creates the exact folder manifest and reconciles the same command without another change', async () => {
  runtime = projectFsRuntime('folder-route', { 'src/pages/index.astro': '<main />' });
  const file = '.starquix/folders.json';
  const afterSource = '{"version":1,"roots":[],"folders":{}}\n';
  expect((await send(file, null, afterSource)).result).toMatchObject({ status: 'written' });
  expect(runtime.read(file)).toBe(afterSource);
  const count = runtime.journal.since(0).entries.length;
  expect((await send(file, null, afterSource)).result).toMatchObject({ status: 'written' });
  expect(runtime.journal.since(0).entries).toHaveLength(count);
  expect((await send(file, null, 'conflicting')).result.status).not.toBe('written');
  expect(runtime.read(file)).toBe(afterSource);
});
it.each(['.starquix/secrets.json', '.starquix/../folders.json', '.starquix/folders.json/extra', 'public/folders.json'])(
  'does not allow unrelated or traversing metadata targets: %s', async file => {
    runtime = projectFsRuntime('folder-route', { 'src/pages/index.astro': '<main />' });
    expect((await send(file, null, 'unexpected')).result.status).not.toBe('written');
    expect(existsSync(join(runtime.root, file))).toBe(false);
    expect(runtime.journal.since(0).entries).toHaveLength(0);
  },
);
