/**
 * task-142: LocalMediaSection.handlePick routing — the original code applied
 * UPDATE_IMAGE_ATTRIBUTE + a DOM-only src mutation to EVERY selected img and
 * toasted success. For astro <Image> elements (no sourceLocation) nothing was
 * ever written: the two-day "bike that can't be deleted or changed" bug.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ChevronTreeIcon: the section header is collapsible, so Row's chevron slot
// resolves it — an icon mock missing it fails the whole file at render.
vi.mock('@/assets/icons', () => ({ PlusIcon: () => null, ChevronTreeIcon: () => null }));

const mockDispatch = vi.fn();
vi.mock('@/store/hooks', () => ({ useDispatch: () => mockDispatch }));
const mockTakeSnapshot = vi.fn();
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot }) }));
// task-144: runtime is switchable per test — local ('/x/site') or WC (null).
let mockProjectIdParam = 'browser_lf_abc';
let mockLocalPath: string | null = '/x/site';
vi.mock('react-router-dom', () => ({ useParams: () => ({ '*': mockProjectIdParam }) }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => mockLocalPath }));

let mockSelected: Record<string, unknown> = {};
vi.mock('@/context/SelectionContext', () => ({ useSelectedElement: () => mockSelected }));

const mockSyncImageAttr = vi.fn();
const mockRebind = vi.fn(async (_pid: string, _old: string, f: File) => ({
  newAsset: `src/content/works/images/P/${f.name}`, updatedFiles: ['a.mdx'],
}));
const mockRepoint = vi.fn(async () => undefined);
vi.mock('@/utils/imageUpload', () => ({
  uploadLocalAssetFile: vi.fn(),
  syncImageAttrToIframe: (...a: unknown[]) => mockSyncImageAttr(...a),
  rebindLocalBoundAsset: (pid: string, old: string, f: File) => mockRebind(pid, old, f),
  repointLocalBoundAsset: (pid: string, from: string, to: string) => mockRepoint(pid, from, to),
}));
const mockToast = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: Object.assign((...a: unknown[]) => mockToast(...a), {
    success: (...a: unknown[]) => mockToast('success', ...a),
    error: (...a: unknown[]) => mockToast('error', ...a),
  }),
}));

// task-144: WC runtime rides a mocked Dexie source; the local source stays real
// (exercised through the fetch mocks below).
const mockDexieList = vi.fn(async () => [
  { name: 'a.png', kind: 'image' as const, thumbUrl: 'blob:editor/a', applySrc: 'sq-asset:A1' },
  { name: 'b.png', kind: 'image' as const, thumbUrl: 'blob:editor/b', applySrc: 'sq-asset:B2' },
]);
const mockDexieUpload = vi.fn(async (_f: File) => undefined);
vi.mock('./assetSources', async (orig) => ({
  ...(await orig() as object),
  makeDexieAssetSource: () => ({ list: mockDexieList, upload: mockDexieUpload }),
}));

import { MediaSection } from './LocalMediaSection';
const LocalMediaSection = MediaSection;

const ASSET = { file: 'public/uploads/bike.jpg', url: '/uploads/bike.jpg', kind: 'image', size: 10 };

describe('LocalMediaSection handlePick routing (task-142)', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockTakeSnapshot.mockClear();
    mockSyncImageAttr.mockClear();
    mockRebind.mockClear();
    mockRepoint.mockClear();
    mockToast.mockClear();
    mockProjectIdParam = 'browser_lf_abc';
    mockLocalPath = '/x/site';
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/__sq/local/assets')) {
        return Response.json({ assets: [ASSET] });
      }
      if (u.includes('/__sq/local/asset-file')) {
        return new Response(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
  });

  const pickBike = async () => {
    render(<LocalMediaSection />);
    const thumb = await screen.findByRole('button', { name: 'public/uploads/bike.jpg' });
    fireEvent.click(thumb);
  };

  it('img WITH sourceLocation → attr write path (dispatch + iframe sync)', async () => {
    mockSelected = {
      key: 'src/pages/index.astro:5:1', tagName: 'img',
      sourceLocation: { file: 'src/pages/index.astro', line: 5, column: 1 },
    };
    await pickBike();
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_IMAGE_ATTRIBUTE', attribute: 'src', value: '/uploads/bike.jpg' })));
    expect(mockSyncImageAttr).toHaveBeenCalled();
    expect(mockRebind).not.toHaveBeenCalled();
  });

  it('content-bound astro <Image> → rebind with the fetched file + repoint undo (never DOM-only)', async () => {
    const BOUND = '/x/site/src/content/works/images/P/P.png';
    mockSelected = { key: 'dynamic:img-1', tagName: 'img', sourceLocation: null, boundAssetPath: BOUND };
    await pickBike();
    await waitFor(() => expect(mockRebind).toHaveBeenCalledWith(
      'browser_lf_abc', BOUND, expect.objectContaining({ name: 'bike.jpg' })));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockSyncImageAttr).not.toHaveBeenCalled();
    const side = mockTakeSnapshot.mock.calls.at(-1)?.[0] as { reverse: () => void };
    side.reverse();
    expect(mockRepoint).toHaveBeenCalledWith('browser_lf_abc', 'src/content/works/images/P/bike.jpg', BOUND);
  });

  it('prop-driven img (no handles) → warning toast, NO dispatch, NO DOM mutation', async () => {
    mockSelected = { key: 'dynamic:img-2', tagName: 'img', sourceLocation: null, boundAssetPath: null };
    await pickBike();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining('component props'), expect.anything()));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockSyncImageAttr).not.toHaveBeenCalled();
    expect(mockRebind).not.toHaveBeenCalled();
  });
});

// task-144: same MediaSection front, Dexie-backed source in WC.
describe('MediaSection with Dexie source (WC, task-144)', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockTakeSnapshot.mockClear();
    mockSyncImageAttr.mockClear();
    mockRebind.mockClear();
    mockToast.mockClear();
    mockDexieList.mockClear();
    mockDexieUpload.mockClear();
    mockSelected = {};
    mockProjectIdParam = 'browser_proj-1';
    mockLocalPath = null;
  });

  it('renders the asset grid from the Dexie source', async () => {
    render(<MediaSection />);
    expect(await screen.findByRole('button', { name: 'a.png' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'b.png' })).toBeTruthy();
  });

  it('upload "+" routes the file through the source upload', async () => {
    render(<MediaSection />);
    await screen.findByRole('button', { name: 'a.png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([1])], 'new.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    await waitFor(() => expect(mockDexieUpload).toHaveBeenCalledWith(file));
  });

  it('pick with a source-located img selected dispatches the sq-asset src + syncs', async () => {
    mockSelected = {
      key: 'src/pages/index.astro:5:1', tagName: 'img',
      sourceLocation: { file: 'src/pages/index.astro', line: 5, column: 1 },
    };
    render(<MediaSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'a.png' }));
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_IMAGE_ATTRIBUTE', attribute: 'src', value: 'sq-asset:A1' })));
    expect(mockSyncImageAttr).toHaveBeenCalled();
    expect(mockTakeSnapshot).toHaveBeenCalled();
  });

  it('pick with no img selection: honest toast, nothing destructive', async () => {
    mockSelected = {};
    render(<MediaSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'a.png' }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRebind).not.toHaveBeenCalled();
  });

  it('bound-looking selection without fileFor support falls to the honest toast (never rebinds)', async () => {
    mockSelected = { key: 'dynamic:img-1', tagName: 'img', sourceLocation: null, boundAssetPath: '/x/a.png' };
    render(<MediaSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'a.png' }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining('component props'), expect.anything()));
    expect(mockRebind).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

it('an unavailable local list is not rendered as an empty media library and supports retry', async () => {
  mockProjectIdParam = 'browser_lf_failed'; mockLocalPath = '/x/failed';
  global.fetch = vi.fn().mockResolvedValueOnce(new Response('private body', { status: 503 })).mockResolvedValue(Response.json({ assets: [] }));
  render(<MediaSection />);
  fireEvent.click(screen.getByText('Media'));
  expect(await screen.findByText('Project media is unavailable.')).toBeVisible();
  expect(screen.queryByText('No media in public/ or src/assets')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No media in public/ or src/assets')).toBeVisible();
});
