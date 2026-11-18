import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), mutation: vi.fn() }));
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: mocks.read }));
vi.mock('@/services/imageMutationReceipts', () => ({ fetchImageMutation: mocks.mutation }));
vi.mock('@/utils/localMode', () => ({ findLocalProjectEntry: () => ({ path: '/project' }), isLocalProjectId: () => true, PROJECT_NOT_READY: 'missing' }));
import { uploadLocalAssetFile, fetchComponentUsages, postComponentDefaultImage, rebindLocalBoundAsset } from '../imageUpload';
beforeEach(() => { vi.clearAllMocks(); });
it.each(['rebind', 'default', 'usages'])('%s rejects a success-shaped response without its receipt fields', async kind => {
  mocks.read.mockResolvedValue(Response.json({})); mocks.mutation.mockResolvedValue(Response.json({}));
  const request = kind === 'rebind' ? rebindLocalBoundAsset('browser_lf_test', 'src/old.png', new File(['x'], 'new.png')) : kind === 'default' ? postComponentDefaultImage('/project', 'src/Card.astro', 0, { clear: true }) : fetchComponentUsages('/project', 'src/Card.astro');
  await expect(request).rejects.toMatchObject({ kind: 'shape' });
});
it('usages failure cannot become an empty list', async () => {
  mocks.read.mockResolvedValue(Response.json({ usages: [], contentUsages: [] }, { status: 503 }));
  await expect(fetchComponentUsages('/project', 'src/Card.astro')).rejects.toMatchObject({ kind: 'http', status: 503 });
});
it('default clear preserves an explicit null previous receipt', async () => {
  mocks.mutation.mockResolvedValue(Response.json({ previous: null, asset: '' }));
  await expect(postComponentDefaultImage('/project', 'src/Card.astro', 0, { clear: true })).resolves.toEqual({ previous: null, asset: '' });
});

it('previews uploaded bytes on the editor origin while retaining the project source path', async () => {
  const bytes = new Uint8Array([0, 127, 128, 255, 42]);
  const file = new File([bytes], 'replacement.png', { type: 'image/png' });
  mocks.mutation.mockImplementation(async (_projectId, _path, _file, preparePreview) => {
    preparePreview(bytes);
    return Response.json({ src: '/uploads/replacement.png', url: '/uploads/replacement.png' });
  });
  const result = await uploadLocalAssetFile('browser_lf_test', file);
  expect(result.src).toBe('/uploads/replacement.png');
  expect(result.previewUrl).toBe('data:image/png;base64,AH+A/yo=');
  expect(mocks.mutation).toHaveBeenCalledWith('browser_lf_test', expect.stringContaining('/__sq/local/asset?'), file, expect.any(Function));
});
