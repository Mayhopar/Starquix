/**
 * ImageUploadOverlay — canvas hover affordance for uploading/replacing an
 * <img>'s src. Covers:
 * - renders nothing when nothing is hovered, or the hovered element isn't an <img>
 * - renders the Upload button for a hovered <img> (regardless of empty/loaded state)
 * - clicking Upload + picking a file dispatches UPDATE_IMAGE_ATTRIBUTE for the
 *   HOVERED element's key and posts SYNC_IMAGE_ATTR_TO_IFRAME
 * - invalid file type surfaces validateImageFile's error, never calls uploadImageFile
 * - upload rejection surfaces an error message
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockRegister = vi.fn();
const mockPushStructuralUndo = vi.fn();
const mockLocalUpload = vi.fn(async () => ({ src: '/uploads/new.png', previewUrl: 'blob:new' }));
let nativeSource = '<img src="/old.png" alt="Mountain" class="w-60 h-40 object-cover">';
const geometry = { display: 'block', boxSizing: 'border-box', maxWidth: '100%', objectFit: 'cover', objectPosition: '50% 50%', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px' };
vi.mock('@/context/ClassStoreContext', () => ({ useClassStore: () => ({ registerElement: mockRegister }) }));
vi.mock('@/utils/pendingSourceWrites', () => ({ flushPendingSourceWrites: async () => {} }));
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: async () => new Response(nativeSource) }));
const mockFillWrite = vi.fn(async (...args: unknown[]) => {
  const { swapElementTagWithUndo } = await import('../../../../preview-template/src/plugins/sq-source-plugin.js');
  const receipt = await swapElementTagWithUndo(nativeSource, { line: 1, column: 1 }, 'image-fill', '', args[3]);
  nativeSource = receipt.updated; return receipt.extra;
});
vi.mock('@/services/ViteMediaWriter', () => ({ viteMediaWriter: { writeTagSwap: (...args: unknown[]) => mockFillWrite(...args) } }));
const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockUploadAsset = vi.fn();
const mockUploadImageFile = vi.fn(async () => ({ src: 'sq-asset:new-id', previewUrl: 'blob:editor/new-id' }));

let mockProjectId: string | null = 'browser_proj-1';
let mockPageId: string | null = 'page-1';

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: (selector: unknown) => {
    const fn = selector as { name?: string };
    if (fn.name === 'selectProjectId') return mockProjectId;
    if (fn.name === 'selectCurrentPageId') return mockPageId;
    return null;
  },
}));

vi.mock('@/store/selectors', () => ({
  selectProjectId: function selectProjectId() { return mockProjectId; },
  selectCurrentPageId: function selectCurrentPageId() { return mockPageId; },
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot, pushStructuralUndo: mockPushStructuralUndo }),
}));

vi.mock('@/hooks/useAssetUpload', () => ({
  useAssetUpload: () => ({ uploadAsset: mockUploadAsset }),
}));

const mockRebindBoundAsset = vi.fn(async (_pid: string, _old: string, file: File) => ({
  newAsset: `src/content/works/images/${file.name}`, updatedFiles: ['src/content/works/a.mdx'],
}));
const mockRepointBoundAsset = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock('@/utils/imageUpload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/imageUpload')>()),
  uploadImageFile: (...args: unknown[]) => mockUploadImageFile(...args),
  uploadLocalAssetFile: (...args: unknown[]) => mockLocalUpload(...args),
  rebindLocalBoundAsset: (pid: string, old: string, f: File) => mockRebindBoundAsset(pid, old, f),
  repointLocalBoundAsset: (...a: unknown[]) => mockRepointBoundAsset(...a),
}));

// task-144: routing source — scanned-elements lookup by hovered key.
interface MockScanned { key: string; classes?: string; sourceLocation?: object; boundAssetPath?: string }
let mockScannedElements: MockScanned[] = [];
vi.mock('@/context/SelectionContext', () => ({
  useScannedElementsRef: () => ({
    scannedElementsRef: { current: mockScannedElements },
    scannedByKeyRef: { current: new Map() },
    treeNodesRef: { current: [] },
  }),
}));

// Import LAST so mocks are wired
import { ImageUploadOverlay } from './ImageUploadOverlay';
import { hoverRectStore } from './hoverRectStore';

const RECT = { top: 10, left: 20, width: 100, height: 80 };

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

describe('ImageUploadOverlay', () => {
  beforeEach(() => {
    mockDispatch.mockReset(); mockFillWrite.mockClear(); mockLocalUpload.mockClear(); mockPushStructuralUndo.mockClear();
    nativeSource = '<img src="/old.png" alt="Mountain" class="w-60 h-40 object-cover">';
    mockTakeSnapshot.mockReset();
    mockUploadAsset.mockReset();
    mockUploadImageFile.mockReset();
    mockUploadImageFile.mockResolvedValue({ src: 'sq-asset:new-id', previewUrl: 'blob:editor/new-id' });
    mockRebindBoundAsset.mockClear();
    mockRepointBoundAsset.mockClear();
    mockScannedElements = [];
    mockProjectId = 'browser_proj-1';
    mockPageId = 'page-1';
    hoverRectStore.set(null);
  });

  it('renders nothing when nothing is hovered', () => {
    const { container } = render(<ImageUploadOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the hovered element is not an <img>', () => {
    hoverRectStore.set({ rect: RECT, key: 'div-1', tagName: 'div' });
    const { container } = render(<ImageUploadOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the Upload button for a hovered <img>', () => {
    hoverRectStore.set({ rect: RECT, key: 'img-1', tagName: 'img' });
    render(<ImageUploadOverlay />);
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('picking a valid file uploads it, dispatches UPDATE_IMAGE_ATTRIBUTE for the hovered key, and syncs to the iframe', async () => {
    const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    hoverRectStore.set({ rect: RECT, key: 'img-1', tagName: 'img' });
    const { container } = render(<ImageUploadOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    selectFile(input, file);

    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());

    expect(mockTakeSnapshot).toHaveBeenCalled();
    expect(mockUploadImageFile).toHaveBeenCalledWith(
      expect.objectContaining({ file, projectId: 'browser_proj-1', pageId: 'page-1' }),
    );
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'img-1', attribute: 'src', value: 'sq-asset:new-id',
    });
    const sync = postMessageSpy.mock.calls.find(
      ([m]) => (m as { type?: string })?.type === 'SYNC_IMAGE_ATTR_TO_IFRAME',
    );
    expect(sync?.[0]).toMatchObject({ payload: { key: 'img-1', attribute: 'src', value: 'sq-asset:new-id' } });
    postMessageSpy.mockRestore();
  });

  it('rejects an invalid file type without calling uploadImageFile', async () => {
    hoverRectStore.set({ rect: RECT, key: 'img-1', tagName: 'img' });
    const { container } = render(<ImageUploadOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    selectFile(input, file);

    await waitFor(() => expect(screen.getByText(/Only PNG, JPEG/i)).toBeInTheDocument());
    expect(mockUploadImageFile).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('surfaces an error message when the upload rejects', async () => {
    mockUploadImageFile.mockRejectedValue(new Error('network down'));
    hoverRectStore.set({ rect: RECT, key: 'img-1', tagName: 'img' });
    const { container } = render(<ImageUploadOverlay />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    selectFile(input, file);

    await waitFor(() => expect(screen.getByText("Image upload couldn't finish. The current image is unchanged.")).toBeInTheDocument());
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // task-144: local-mode picks route by WHAT the img is (same law as
  // LocalMediaSection.handlePick) — never fake success via DOM ghosts.
  describe('local-mode selection-type routing (task-144)', () => {
    beforeEach(() => {
      mockProjectId = 'browser_lf_abc';
    });

    it('bound astro <Image>: routes to rebindLocalBoundAsset, no UPDATE_IMAGE_ATTRIBUTE, no DOM sync', async () => {
      const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
      mockScannedElements = [{ key: 'img-b', boundAssetPath: 'src/content/works/images/old.png' }];
      hoverRectStore.set({ rect: RECT, key: 'img-b', tagName: 'img' });
      const { container } = render(<ImageUploadOverlay />);

      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = new File(['x'], 'new.png', { type: 'image/png' });
      selectFile(input, file);

      await waitFor(() => expect(mockRebindBoundAsset).toHaveBeenCalledWith('browser_lf_abc', 'src/content/works/images/old.png', file));
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockUploadImageFile).not.toHaveBeenCalled();
      const sync = postMessageSpy.mock.calls.find(
        ([m]) => (m as { type?: string })?.type === 'SYNC_IMAGE_ATTR_TO_IFRAME',
      );
      expect(sync).toBeUndefined();
      // undo is a repoint pair, not a doc snapshot
      expect(mockTakeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        reverse: expect.any(Function), forward: expect.any(Function),
      }));
      postMessageSpy.mockRestore();
    });

    it('prop-driven img (no handle): shows honest error, dispatches nothing, never syncs DOM', async () => {
      const postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
      mockScannedElements = [{ key: 'img-p' }];
      hoverRectStore.set({ rect: RECT, key: 'img-p', tagName: 'img' });
      const { container } = render(<ImageUploadOverlay />);

      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      selectFile(input, new File(['x'], 'new.png', { type: 'image/png' }));

      await waitFor(() => expect(screen.getByText(/component/i)).toBeInTheDocument());
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockUploadImageFile).not.toHaveBeenCalled();
      expect(mockRebindBoundAsset).not.toHaveBeenCalled();
      expect(mockTakeSnapshot).not.toHaveBeenCalled();
      const sync = postMessageSpy.mock.calls.find(
        ([m]) => (m as { type?: string })?.type === 'SYNC_IMAGE_ATTR_TO_IFRAME',
      );
      expect(sync).toBeUndefined();
      postMessageSpy.mockRestore();
    });

    it('source-located image is replaced in place through the image attribute tier', async () => {
      mockScannedElements = [{ key: 'img-s', classes: 'w-60 h-40 object-cover', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 } }];
      hoverRectStore.set({ rect: RECT, key: 'img-s', tagName: 'img', computedStyles: geometry });
      const { container } = render(<ImageUploadOverlay />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
      expect(mockFillWrite).not.toHaveBeenCalled();
      await act(async () => { selectFile(container.querySelector('input')!, new File(['x'], 'new.png', { type: 'image/png' })); });
      // Figma model (2026-09-16): the src is replaced in place through the image
      // attribute tier — no img→div conversion, no source rewrite, no structural undo.
      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'img-s', attribute: 'src', value: '/uploads/new.png' }));
      expect(nativeSource).toContain('<img'); expect(mockFillWrite).not.toHaveBeenCalled(); expect(mockPushStructuralUndo).not.toHaveBeenCalled();
    });
    it('a native upload completion cannot mutate after hover moves to another image', async () => {
      let finish!: (value: { src: string; previewUrl: string }) => void;
      mockLocalUpload.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      mockScannedElements = [{ key: 'img-s', classes: 'w-60 h-40 object-cover', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 } }];
      hoverRectStore.set({ rect: RECT, key: 'img-s', tagName: 'img', computedStyles: geometry });
      const { container } = render(<ImageUploadOverlay />);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
      selectFile(container.querySelector('input')!, new File(['x'], 'new.png', { type: 'image/png' }));
      await waitFor(() => expect(mockLocalUpload).toHaveBeenCalledTimes(1));
      await act(async () => { hoverRectStore.set({ rect: RECT, key: 'other', tagName: 'img' }); });
      await act(async () => { finish({ src: '/uploads/new.png', previewUrl: 'blob:new' }); });
      expect(mockFillWrite).not.toHaveBeenCalled(); expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});
