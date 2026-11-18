/**
 * FillBlock Tests (task-011)
 *
 * Regression tests for the FillBlock image-tab upload flow. Covers:
 * - Tab auto-detect: bg-[url(...)] class -> 'image' tab is active
 * - URL input is initialized from the parsed bg-[url('...')] class
 * - Empty 'image' tab still renders the upload zone and URL input
 * - Editing the image URL on blur takes a snapshot and emits onClassesChange
 *   with bg-[url('<sanitized>')] appended
 * - Invalid URL on blur is rejected (no onClassesChange, no snapshot)
 * - Non-image files surface validateImageFile error and skip upload
 * - Browser-mode upload calls uploadAsset + transferAssetToIframe and ends in
 *   onClassesChange with bg-[url('sq-asset:...')]
 * - Cloud-mode upload uses the API + fetch PUT and ends in onClassesChange
 *   with bg-[url('<publicUrl>')]
 *
 * Mocks Yjs hooks, project context, useAssetUpload, transferAssetToIframe, and
 * the API client. Solid/gradient tab logic is out of scope for image-upload
 * coverage and intentionally untouched.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { swapElementTagWithUndo } from '../../../../../preview-template/src/plugins/sq-source-plugin.js';

// Stub SVG icon imports — Vite's `?react` resolver is not active in vitest, so
// the real module would try to render data-URL strings as components.
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return {
    ChevronDownIcon: Stub,
    ColorIcon: Stub,
    PlusIcon: Stub,
    MinusIcon: Stub,
    CheckIcon: Stub,
    XIcon: Stub,
    CloseIcon: Stub,
    UploadIcon: Stub,
    ImageIcon: Stub,
  };
});

// ----------------------------------------------------------------------------
// Mocks
// ----------------------------------------------------------------------------

const mockRegister = vi.fn();
vi.mock('@/context/ClassStoreContext', () => ({ useClassStore: () => ({ registerElement: mockRegister }) }));
vi.mock('@/utils/pendingSourceWrites', () => ({ flushPendingSourceWrites: async () => {} }));
let fillSource = '';
vi.mock('@/utils/sqLocalBase', () => ({ localFetch: async () => new Response(fillSource), localUrl: (url: string) => url }));
const mockTakeSnapshot = vi.fn();
let mockCurrentTakeSnapshot = mockTakeSnapshot;
const mockPushStructuralUndo = vi.fn();
const mockUploadAsset = vi.fn(async (_file: File) => ({
  assetId: 'bg-asset-id',
  editorBlobUrl: 'blob:editor/bg',
}));
const mockTransferAsset = vi.fn(async (_id: string, _blob: Blob) => undefined);

let mockProjectId: string | null = 'browser_proj-1';
let mockPageId: string | null = 'page-1';

const mockDispatch = vi.fn();
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
  selectCurrentPageId: function selectCurrentPageId() { return mockPageId; },
  selectProjectId: function selectProjectId() { return mockProjectId; },
}));

// task-140/141: media-fill selection info — default to a non-eligible selection
let mockSelectedElement: Record<string, unknown> = {
  key: null, tagName: null, sourceLocation: null, mediaFill: false,
  hasElementChildren: false, imageAlt: null,
};
const mockSelect = vi.fn();
vi.mock('@/context/SelectionContext', () => ({
  useSelectedElement: () => mockSelectedElement,
  useSelectionContext: () => ({ select: mockSelect, patchSelection: vi.fn() }),
  useRectActions: () => ({ updateSelectionRect: vi.fn(), getSelectedRect: () => ({ top: 0, left: 0, width: 1200, height: 675 }) }),
}));
let mockLocalPath: string | null = null;
vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => mockLocalPath,
}));
const swapReceipt = { changed: true, replacedLine: 5, originalLineCount: 1, replacedLineCount: 1,
  originalSegment: '<img src="/old.png" alt="Release image" />\n', replacementSegment: '<img src="/new.png" alt="Release image" />\n' };
const mockWriteTagSwap = vi.fn<(...args: unknown[]) => Promise<typeof swapReceipt | false>>(async () => swapReceipt);
vi.mock('@/services/ViteMediaWriter', () => ({
  viteMediaWriter: { writeTagSwap: (...a: unknown[]) => mockWriteTagSwap(...a) },
}));
const mockUploadLocalAssetFile = vi.fn(async (_pid: string, file: File) => ({
  src: `/uploads/${file.name}`, previewUrl: `blob:local/${file.name}`,
}));
const mockSyncImageAttr = vi.fn();
const mockRebindBoundAsset = vi.fn(async (_pid: string, _old: string, file: File) => ({
  newAsset: `src/content/works/images/Petcube/${file.name}`, updatedFiles: ['src/content/works/Petcube.mdx'],
}));
const mockRepointBoundAsset = vi.fn(async (..._a: unknown[]) => undefined);
const mockFetchUsages = vi.fn(async (_path: string, _file: string) => ({ usages: [], contentUsages: [] }));
const mockPostDefaultImage = vi.fn(async (..._a: unknown[]) => ({ previous: null as string | null, asset: '' }));
const mockUploadImageFile = vi.fn(async (_p: unknown) => ({ src: 'sq-asset:new-1', previewUrl: 'blob:editor/new-1' }));
vi.mock('@/utils/imageUpload', () => ({
  uploadImageFile: (...a: unknown[]) => mockUploadImageFile(...a),
  uploadLocalAssetFile: (pid: string, f: File) => mockUploadLocalAssetFile(pid, f),
  syncImageAttrToIframe: (...a: unknown[]) => mockSyncImageAttr(...a),
  rebindLocalBoundAsset: (pid: string, old: string, f: File) => mockRebindBoundAsset(pid, old, f),
  repointLocalBoundAsset: (...a: unknown[]) => mockRepointBoundAsset(...a),
  makePlaceholderImageFile: async () => new File([new Uint8Array([1])], 'placeholder.png', { type: 'image/png' }),
  fetchComponentUsages: (path: string, file: string) => mockFetchUsages(path, file),
  postComponentDefaultImage: (...a: unknown[]) => mockPostDefaultImage(...a),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockCurrentTakeSnapshot, pushStructuralUndo: mockPushStructuralUndo }),
}));

vi.mock('@/hooks/useAssetUpload', () => ({
  useAssetUpload: () => ({
    uploadAsset: mockUploadAsset,
    getAssetUrl: vi.fn(async () => null),
  }),
}));

vi.mock('@/utils/assetTransfer', () => ({
  transferAssetToIframe: (id: string, blob: Blob) => mockTransferAsset(id, blob),
}));

// task-143: usage picker deps — doc pages + page switch (PagesContext) are
// mocked; the component-view flag uses the REAL singleton (set per test).
let mockDocPages: Array<{ id: string; name: string }> = [];
const mockSetActivePage = vi.fn();
vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({ pages: mockDocPages, setActivePage: mockSetActivePage }),
}));
import { setLocalComponentViewFile } from '@/services/localComponentView';

// Import LAST so mocks are wired
import { FillBlock } from './FillBlock';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function renderBlock(overrides: Partial<React.ComponentProps<typeof FillBlock>> = {}) {
  const props: React.ComponentProps<typeof FillBlock> = {
    classes: '',
    onClassesChange: vi.fn(),
    ...overrides,
  };
  const utils = render(<FillBlock {...props} />);
  return { ...utils, props };
}

function getFileInput(): HTMLInputElement {
  // FillBlock renders one hidden file input inside the image tab.
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error('file input not found — is the Image tab active?');
  return input;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('FillBlock', () => {
  beforeEach(() => {
    mockTakeSnapshot.mockReset();
    mockCurrentTakeSnapshot = mockTakeSnapshot;
    setActiveSaveProjectId(null);
    mockPushStructuralUndo.mockReset();
    mockUploadAsset.mockClear();
    mockTransferAsset.mockClear();
    mockProjectId = 'browser_proj-1';
    mockPageId = 'page-1';
    mockLocalPath = null;
    mockDispatch.mockClear();
    mockWriteTagSwap.mockClear();
    mockWriteTagSwap.mockResolvedValue(swapReceipt);
    mockUploadLocalAssetFile.mockClear();
    mockSyncImageAttr.mockClear();
    mockSelectedElement = {
      key: null, tagName: null, sourceLocation: null, mediaFill: false,
      hasElementChildren: false, imageAlt: null,
    };
    setLocalComponentViewFile(null);
    mockDocPages = [];
    mockSetActivePage.mockClear();
    // jsdom does not implement createObjectURL — local previews call it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = vi.fn((blob: Blob) => `blob:mock/${(blob as Blob).size}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('opens on Media tab when classes contain a bg-[url(...)] token, with URL pre-filled', () => {
    renderBlock({ classes: "bg-[url('https://example.com/bg.webp')]" });
    // The Image-tab specific URL input is the only text input rendered in this state.
    const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg') as HTMLInputElement;
    expect(urlInput.value).toBe('https://example.com/bg.webp');
    expect(screen.getByText(/Drop image or click to browse/i)).toBeInTheDocument();
  });

  it('opens on Solid tab by default and allows switching to Media', () => {
    renderBlock({ classes: '' });
    // Solid tab shows ColorPicker (no URL input). Switch to Image.
    fireEvent.click(screen.getByRole('button', { name: /Media/ }));
    expect(screen.getByText(/Drop image or click to browse/i)).toBeInTheDocument();
    const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg') as HTMLInputElement;
    expect(urlInput.value).toBe('');
  });

  it('blurring the URL input with a new value snapshots and calls onClassesChange with bg-[url(...)]', () => {
    const onClassesChange = vi.fn();
    renderBlock({
      classes: "bg-[url('https://old.example/old.png')]",
      onClassesChange,
    });

    const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg') as HTMLInputElement;
    fireEvent.change(urlInput, { target: { value: 'https://new.example/new.png' } });
    fireEvent.blur(urlInput);

    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(onClassesChange).toHaveBeenCalledTimes(1);
    expect(onClassesChange.mock.calls[0][0]).toContain("bg-[url('https://new.example/new.png')]");
    // The previous URL token should have been removed.
    expect(onClassesChange.mock.calls[0][0]).not.toContain('old.png');
  });

  // task-142: background images previously had NO remove affordance at all —
  // the only way out was manually blanking the URL field.
  it('background image with a preview gets a hover ✕ that snapshots and clears the bg-[url] token', () => {
    const onClassesChange = vi.fn();
    renderBlock({
      classes: "bg-[url('https://example.com/bg.webp')] bg-cover",
      onClassesChange,
      bgImagePreviewDataUrl: 'data:image/png;base64,xyz',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove background image' }));
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(onClassesChange).toHaveBeenCalledTimes(1);
    expect(onClassesChange.mock.calls[0][0]).not.toContain('bg-[url');
  });

  it('background image URL without a preview still shows a visible Remove button', () => {
    const onClassesChange = vi.fn();
    renderBlock({
      classes: "bg-[url('https://example.com/bg.webp')]",
      onClassesChange,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove background image' }));
    expect(onClassesChange.mock.calls[0][0]).not.toContain('bg-[url');
  });

  it('blurring the URL input with no change does not snapshot or emit', () => {
    const onClassesChange = vi.fn();
    renderBlock({
      classes: "bg-[url('https://same.example/x.png')]",
      onClassesChange,
    });

    const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg') as HTMLInputElement;
    fireEvent.blur(urlInput);

    expect(mockTakeSnapshot).not.toHaveBeenCalled();
    expect(onClassesChange).not.toHaveBeenCalled();
  });

  it('rejects non-image files via validateImageFile and never invokes uploadAsset', async () => {
    const onClassesChange = vi.fn();
    renderBlock({ classes: '', onClassesChange });
    fireEvent.click(screen.getByRole('button', { name: /Media/ }));

    const fileInput = getFileInput();
    const badFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [badFile] } });
    });

    expect(screen.getByText(/Only PNG, JPEG, GIF, WebP, and SVG/i)).toBeInTheDocument();
    expect(mockUploadAsset).not.toHaveBeenCalled();
    expect(mockTransferAsset).not.toHaveBeenCalled();
    expect(onClassesChange).not.toHaveBeenCalled();
  });

  it('browser-mode upload: uploadAsset + transfer + onClassesChange with sq-asset url', async () => {
    mockProjectId = 'browser_proj-1';
    const onClassesChange = vi.fn();
    renderBlock({ classes: '', onClassesChange });
    fireEvent.click(screen.getByRole('button', { name: /Media/ }));

    const file = new File([new Uint8Array([1, 2, 3])], 'bg.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(getFileInput(), { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(mockUploadAsset).toHaveBeenCalledWith(file);
    });
    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockTransferAsset).toHaveBeenCalledWith('bg-asset-id', file);

    // Last onClassesChange call should embed the sq-asset ref in a bg-[url('...')] token.
    const lastCall = onClassesChange.mock.calls.at(-1)?.[0] as string;
    expect(lastCall).toContain("bg-[url('sq-asset:bg-asset-id')]");
  });

  it('upload reports an error when projectId or pageId is missing', async () => {
    mockProjectId = null;
    renderBlock({ classes: '', onClassesChange: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: /Media/ }));

    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(getFileInput(), { target: { files: [file] } });
    });

    expect(screen.getByText(/Project or page not found/i)).toBeInTheDocument();
    expect(mockUploadAsset).not.toHaveBeenCalled();
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
  });

  // task-141: the bg-url Image tab is absorbed into Media
  it('shows Media tab (no Image tab) active for an element with bg-[url(...)] classes', () => {
    renderBlock({ classes: 'bg-[url(/a.jpg)] bg-cover' });
    expect(screen.queryByRole('button', { name: 'Image' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Media' })).toBeInTheDocument();
    // Media tab is active and shows the background treatment (URL input)
    const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg') as HTMLInputElement;
    expect(urlInput.value).toBe('/a.jpg');
  });

  describe('literal local image Fill (task-232)', () => {
    const LOC = { file: 'src/pages/index.astro', line: 5, column: 3 };
    const classes = 'w-60 h-40 object-cover';
    const open = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Edit image Fill' }));
    };
    beforeEach(() => {
      mockLocalPath = '/Users/x/site'; mockProjectId = 'browser_lf_abc';
      fillSource = '\n\n\n\n  <img src="/uploads/old.jpg" alt="Mountain" class="w-60 h-40 object-cover">';
      mockSelectedElement = { key: 'src/pages/index.astro:5:3', tagName: 'img', sourceLocation: LOC,
        mediaFill: false, hasElementChildren: false, imageAlt: 'Mountain', imageSrc: '/uploads/old.jpg',
        imagePreviewDataUrl: 'data:image/png;base64,old',
        computedStyles: { display: 'block', boxSizing: 'border-box', maxWidth: '100%', objectFit: 'cover', objectPosition: '50% 50%', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px', borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px' } };
      mockWriteTagSwap.mockImplementation(async (_loc, _kind, _src, request) => {
        const result = await swapElementTagWithUndo(fillSource, LOC, 'image-fill', '', request);
        fillSource = result.updated; return result.extra;
      });
    });
    it('opens compact Image details without writes and preserves the preview', async () => {
      renderBlock({ classes }); await open();
      expect(screen.getByRole('group', { name: 'Image fit' })).toBeVisible();
      expect(document.querySelector('img[src="data:image/png;base64,old"]')).toBeTruthy();
      expect(mockWriteTagSwap).not.toHaveBeenCalled(); expect(mockPushStructuralUndo).not.toHaveBeenCalled();
    });
    it('the tab IS the fill kind: choosing Color converts the <img> into a white container (exclusive kinds, 2026-09-20)', async () => {
      renderBlock({ classes }); await screen.findByRole('button', { name: 'Edit image Fill' });
      fireEvent.click(screen.getByRole('tab', { name: 'Color' }));
      await waitFor(() => expect(mockWriteTagSwap).toHaveBeenCalledTimes(1));
      expect(fillSource.trim()).toBe('<div data-sq-image-fill="true" class="w-60 h-40 max-w-full bg-white"></div>'); // max-w-full: the img's computed max-width 100% is preserved
      expect(screen.queryByRole('button', { name: 'Edit image Fill' })).toBeNull(); // no image chooser under Color
    });
    it('fit is an object-* class change on the <img> — no source conversion, no structural undo', async () => {
      const onClassesChange = vi.fn(); renderBlock({ classes, onClassesChange }); await open();
      fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
      await waitFor(() => expect(onClassesChange).toHaveBeenCalledWith('w-60 h-40 object-contain'));
      expect(fillSource).toContain('<img'); expect(mockWriteTagSwap).not.toHaveBeenCalled(); expect(mockPushStructuralUndo).not.toHaveBeenCalled();
    });
    it('description is the alt attribute through the image override tier', async () => {
      renderBlock({ classes }); await open();
      const field = screen.getByRole('textbox', { name: 'Image description' });
      fireEvent.change(field, { target: { value: 'New mountain' } }); fireEvent.blur(field);
      await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/pages/index.astro:5:3', attribute: 'alt', value: 'New mountain' }));
      expect(mockWriteTagSwap).not.toHaveBeenCalled(); expect(mockPushStructuralUndo).not.toHaveBeenCalled();
    });
    it('an intrinsically sized image (h-auto) is editable like any other — Figma model, no "needs its source" gate', async () => {
      fillSource = fillSource.replace('h-40', 'h-auto'); renderBlock({ classes: 'w-60 h-auto' }); await open();
      expect(screen.getByRole('group', { name: 'Image fit' })).toBeVisible();
      expect(screen.queryByText('This image needs its source or binding.')).toBeNull();
    });
    it('video files do not change a native image to video', async () => {
      renderBlock({ classes }); await open();
      await act(async () => { fireEvent.change(getFileInput(), { target: { files: [new File(['x'], 'clip.mp4', { type: 'video/mp4' })] } }); });
      expect(mockWriteTagSwap).not.toHaveBeenCalled(); expect(mockUploadLocalAssetFile).not.toHaveBeenCalled();
    });
    it('replacement sets the src attribute in place and shows the uploaded preview', async () => {
      renderBlock({ classes }); await open();
      await act(async () => { fireEvent.change(getFileInput(), { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } }); });
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/pages/index.astro:5:3', attribute: 'src', value: '/uploads/new.png' });
      expect(fillSource).toContain('<img'); expect(document.querySelector('img[src="blob:local/new.png"]')).toBeTruthy(); expect(mockPushStructuralUndo).not.toHaveBeenCalled();
    });
    it('Fit never touches the source file, so a refused source write cannot fail it', async () => {
      // (no writer stub: Fit never reaches the writer; a queued stub would leak into the next test)
      renderBlock({ classes, onClassesChange: vi.fn() }); await open();
      fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
      await waitFor(() => expect(screen.queryByText("Fill couldn't be changed.")).toBeNull());
      expect(mockWriteTagSwap).not.toHaveBeenCalled(); expect(fillSource).toContain('<img');
    });
    it('Remove image takes the picture out of the design: the <img> becomes a fill-less container (never src="")', async () => {
      renderBlock({ classes }); await open(); fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
      await waitFor(() => expect(mockWriteTagSwap).toHaveBeenCalledTimes(1));
      expect(fillSource.trim()).toBe('<div data-sq-image-fill="true" class="w-60 h-40 max-w-full"></div>');
      expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_IMAGE_ATTRIBUTE', attribute: 'src', value: '' }));
    });
  });

  // task-141 follow-up: no arming step — childless local container's Media tab
  // IS the dropzone (slot button removed as redundant).
  // task-142: astro <Image> bound to content data — no sourceLocation, but the
  // bridge decodes the bound src/ asset path. Media tab = data-aware swap.
  describe('bound media (astro <Image>, local mode)', () => {
    const BOUND = '/Users/x/site/src/content/works/images/Petcube/old.png';
    beforeEach(() => {
      mockLocalPath = '/Users/x/site';
      mockProjectId = 'browser_lf_abc';
      mockRebindBoundAsset.mockClear();
      mockRepointBoundAsset.mockClear();
      mockSelectedElement = {
        key: 'dynamic:img-1', tagName: 'img', sourceLocation: null,
        mediaFill: false, hasElementChildren: false, imageAlt: 'Petcube',
        boundAssetPath: BOUND, imagePreviewDataUrl: 'data:image/png;base64,xyz',
      };
    });

    it('bound image uses compact read-only inspection before opening its semantic controls', () => {
      renderBlock({ classes: 'w-full' });
      expect(screen.queryByText(/updates the content data/i)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.getByText(/updates the content data/i)).toBeVisible();
      expect(screen.queryByRole('textbox', { name: 'Image URL' })).toBeNull();
      expect(mockRebindBoundAsset).not.toHaveBeenCalled(); expect(mockWriteTagSwap).not.toHaveBeenCalled();
    });

    it('the compact bound controls retain the data-aware dropzone without alt or fit', () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.getByText(/updates the content data/i)).toBeInTheDocument();
      expect(screen.queryByText('Fit')).toBeNull();
      // schema requires an image — the note explains remove = placeholder swap
      expect(screen.getByText(/using a placeholder can be undone/i)).toBeInTheDocument();
    });

    it('upload and placeholder actions are visible inside the bound popover', () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Use placeholder' })).toBeInTheDocument();
    });

    it('Use placeholder rebinds to a generated placeholder and Undo repoints back', async () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      fireEvent.click(screen.getByRole('button', { name: 'Use placeholder' }));
      await waitFor(() => {
        expect(mockRebindBoundAsset).toHaveBeenCalledWith(
          'browser_lf_abc', BOUND, expect.objectContaining({ name: 'placeholder.png' }));
      });
      const sideEffect = mockTakeSnapshot.mock.calls.at(-1)?.[0] as
        { reverse: () => void };
      sideEffect.reverse();
      expect(mockRepointBoundAsset).toHaveBeenCalledWith(
        'browser_lf_abc', 'src/content/works/images/Petcube/placeholder.png', BOUND);
    });

    it('drop rebinds via rebindLocalBoundAsset and registers repoint undo/redo', async () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      const zone = screen.getByText(/updates the content data/i).closest('[role="button"]')!;
      const file = new File([new Uint8Array([1])], 'bike.jpg', { type: 'image/jpeg' });
      await act(async () => {
        fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      });
      await waitFor(() => {
        expect(mockRebindBoundAsset).toHaveBeenCalledWith('browser_lf_abc', BOUND, file);
      });
      const sideEffect = mockTakeSnapshot.mock.calls.at(-1)?.[0] as
        { reverse: () => void; forward: () => void };
      sideEffect.reverse();
      expect(mockRepointBoundAsset).toHaveBeenCalledWith(
        'browser_lf_abc', 'src/content/works/images/Petcube/bike.jpg', BOUND);
      sideEffect.forward();
      expect(mockRepointBoundAsset).toHaveBeenLastCalledWith(
        'browser_lf_abc', BOUND, 'src/content/works/images/Petcube/bike.jpg');
    });

    it('non-image files are rejected with an error', async () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      const zone = screen.getByText(/updates the content data/i).closest('[role="button"]')!;
      const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
      await act(async () => {
        fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      });
      expect(mockRebindBoundAsset).not.toHaveBeenCalled();
      expect(screen.getByText(/up to 10 MB/i)).toBeInTheDocument();
    });

    it.each(['unsupported', 'oversized'])('bound %s images refuse before the existing rebind adapter', async kind => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      const file = new File(['x'], 'new.png', { type: kind === 'unsupported' ? 'image/tiff' : 'image/png' });
      if (kind === 'oversized') Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 });
      fireEvent.change(getFileInput(), { target: { files: [file] } });
      expect(mockRebindBoundAsset).not.toHaveBeenCalled(); expect(screen.getByText(/up to 10 MB/i)).toBeVisible();
    });
    it.each(['selection', 'page', 'unmount', 'project', 'project-return', 'path', 'history-provider', 'active-project'])('acknowledged bound replacement respects the %s history owner', async change => {
      let finish!: (value: { newAsset: string; updatedFiles: string[] }) => void;
      mockRebindBoundAsset.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const { rerender, unmount } = renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      fireEvent.change(getFileInput(), { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } });
      mockSelectedElement = { ...mockSelectedElement, key: 'other-image', boundAssetPath: '/other/bound.png' };
      if (change === 'page') mockPageId = 'other-page';
      if (change.startsWith('project')) mockProjectId = 'browser_lf_other';
      if (change === 'path') mockLocalPath = '/different-project';
      if (change === 'history-provider') mockCurrentTakeSnapshot = vi.fn();
      if (change === 'active-project') setActiveSaveProjectId('browser_lf_other');
      rerender(<FillBlock classes="w-full" onClassesChange={vi.fn()} />);
      if (change === 'project-return') { mockProjectId = 'browser_lf_abc'; rerender(<FillBlock classes="w-full" onClassesChange={vi.fn()} />); }
      if (change === 'unmount') unmount();
      await act(async () => { finish({ newAsset: 'src/content/works/images/Petcube/new.png', updatedFiles: ['src/content/works/Petcube.mdx'] }); });
      if (!['selection', 'page', 'unmount'].includes(change)) { expect(mockTakeSnapshot).not.toHaveBeenCalled(); expect(mockCurrentTakeSnapshot).not.toHaveBeenCalled(); return; }
      expect(mockTakeSnapshot).toHaveBeenCalledOnce();
      const receipt = mockTakeSnapshot.mock.calls[0][0] as { reverse: () => void; forward: () => void };
      receipt.reverse(); expect(mockRepointBoundAsset).toHaveBeenLastCalledWith('browser_lf_abc', 'src/content/works/images/Petcube/new.png', BOUND);
      receipt.forward(); expect(mockRepointBoundAsset).toHaveBeenLastCalledWith('browser_lf_abc', BOUND, 'src/content/works/images/Petcube/new.png');
      expect(screen.queryByText(/save needs checking/i)).toBeNull();
    });

    it('a bound replacement failure after switching selection cannot leak its issue or Undo', async () => {
      let reject!: (error: Error) => void;
      mockRebindBoundAsset.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
      const { rerender } = renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      fireEvent.change(getFileInput(), { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } });
      mockSelectedElement = { ...mockSelectedElement, key: 'other-image' };
      rerender(<FillBlock classes="w-full" onClassesChange={vi.fn()} />);
      await act(async () => { reject(new Error('private path')); });
      expect(screen.queryByText(/save needs checking/i)).toBeNull(); expect(mockTakeSnapshot).not.toHaveBeenCalled();
    });

    it('shows the Edit <component> jump when the img lives in a component', () => {
      mockSelectedElement = {
        ...mockSelectedElement,
        ownerComponentFile: 'src/components/FeaturedWork.astro',
      };
      const spy = vi.fn();
      window.addEventListener('sq:go-to-source-component', spy);
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit FeaturedWork.astro' }));
      expect((spy.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'src/components/FeaturedWork.astro' });
      window.removeEventListener('sq:go-to-source-component', spy);
    });
  });

  // task-142: local img with no handle (astro <Image src={prop}> in the
  // component view) — honest props note, nothing writable.
  describe('prop-driven img (local component view)', () => {
    beforeEach(() => {
      mockLocalPath = '/Users/x/site';
      mockProjectId = 'browser_lf_abc';
      mockSelectedElement = {
        key: 'dynamic:img-2', tagName: 'img', sourceLocation: null,
        mediaFill: false, hasElementChildren: false, imageAlt: 'Placeholder',
        boundAssetPath: null, imagePreviewDataUrl: 'data:image/png;base64,xyz',
      };
    });

    it('Media tab shows the props note — no dropzone, no file input', () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.getByText(/comes from component props/i)).toBeInTheDocument();
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(screen.queryByRole('button', { name: /Remove media/i })).toBeNull();
    });

    it('Edit <component> button dispatches sq:go-to-source-component with the owner path', () => {
      mockSelectedElement = {
        ...mockSelectedElement,
        ownerComponentFile: 'src/components/FeaturedWork.astro',
      };
      const spy = vi.fn();
      window.addEventListener('sq:go-to-source-component', spy);
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit FeaturedWork.astro' }));
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as CustomEvent).detail).toEqual({ path: 'src/components/FeaturedWork.astro' });
      window.removeEventListener('sq:go-to-source-component', spy);
    });

    it('no owner known → note only, no Edit button', () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.queryByRole('button', { name: /^Edit .*\.astro$/i })).toBeNull();
    });
  });

  // task-143: INSIDE the component view the props note becomes a usage
  // picker — pages that (transitively) render the component, dynamic routes
  // expanded to their seeded concrete instances. Clicking one exits the
  // component view and switches to that page.
  describe('usage picker (prop-driven img INSIDE the component view)', () => {
    beforeEach(() => {
      mockLocalPath = '/Users/x/site';
      mockProjectId = 'browser_lf_abc';
      setLocalComponentViewFile('src/components/FeaturedWork.astro');
      mockSelectedElement = {
        key: 'dynamic:img-2', tagName: 'img', sourceLocation: null,
        mediaFill: false, hasElementChildren: false, imageAlt: 'Placeholder',
        boundAssetPath: null, ownerComponentFile: 'src/components/FeaturedWork.astro',
      };
      mockDocPages = [
        { id: 'index', name: '/' },
        { id: 'works-inito', name: '/works/inito' },
        { id: 'works-older', name: '/works/older' },
        { id: 'about', name: '/about' },
      ];
      mockFetchUsages.mockReset();
      mockPostDefaultImage.mockReset();
      mockPostDefaultImage.mockResolvedValue({ previous: null, asset: '' });
      mockFetchUsages.mockResolvedValue({
        usages: [
          { route: '/', file: 'src/pages/index.astro', editable: true },
          { route: '/works/[slug]', file: 'src/pages/works/[slug].astro', editable: true, dynamic: true },
        ],
        contentUsages: [],
      });
    });

    it('default image uses the same compact shell without writing on open', async () => {
      renderBlock({ classes: 'w-full' });
      expect(document.querySelector('input[type="file"]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(await screen.findByRole('button', { name: 'Upload image' })).toBeVisible();
      expect(screen.queryByRole('textbox', { name: 'Image URL' })).toBeNull();
      expect(mockPostDefaultImage).not.toHaveBeenCalled(); expect(mockWriteTagSwap).not.toHaveBeenCalled();
    });

    it('lists a button per usage page (dynamic route → its concrete instances), no props note', async () => {
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(await screen.findByRole('button', { name: '/' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '/works/inito' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '/works/older' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '/about' })).toBeNull();
      expect(screen.queryByText(/comes from component props/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^Edit .*\.astro$/i })).toBeNull();
      expect(mockFetchUsages).toHaveBeenCalledWith('/Users/x/site', 'src/components/FeaturedWork.astro');
    });

    it('clicking a usage fires sq:go-to-page (sidebar exits the component view) and switches page', async () => {
      const exitSpy = vi.fn();
      window.addEventListener('sq:go-to-page', exitSpy);
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      fireEvent.click(await screen.findByRole('button', { name: '/works/inito' }));
      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(mockSelect).toHaveBeenCalledWith(null);
      expect(mockSetActivePage).toHaveBeenCalledWith('works-inito');
      window.removeEventListener('sq:go-to-page', exitSpy);
    });

    it('content-only usage (.mdx import) maps by slug to the concrete page', async () => {
      mockFetchUsages.mockResolvedValue({
        usages: [],
        contentUsages: [{ file: 'src/content/works/Older.mdx', collection: 'works', slug: 'older' }],
      });
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(await screen.findByRole('button', { name: '/works/older' })).toBeInTheDocument();
      expect(screen.queryByText(/No page renders this component yet/i)).toBeNull();
    });

    it('a blank default exposes upload without a reset action', async () => {
      mockFetchUsages.mockResolvedValue({ usages: [], contentUsages: [] });
      await act(async () => { renderBlock({ classes: 'w-full' }); });
      fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reset default image' })).toBeNull();
      expect(screen.getByText(/becomes the component default/i)).toBeInTheDocument();
      expect(screen.queryByText(/comes from component props/i)).toBeNull();
    });

    it('an existing default exposes upload and reset', async () => {
      mockSelectedElement = {
        ...mockSelectedElement,
        boundAssetPath: '/Users/x/site/src/assets/sq-defaults/hero.jpg',
      };
      mockFetchUsages.mockResolvedValue({ usages: [], contentUsages: [] });
      await act(async () => { renderBlock({ classes: 'w-full' }); });
      fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset default image' })).toBeInTheDocument();
    });

    it('default replacement retains its receipt-based Undo and never normalizes', async () => {
      mockPostDefaultImage.mockResolvedValue({ previous: 'src/assets/old.png', asset: 'src/assets/new.png' });
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      const file = new File(['x'], 'new.png', { type: 'image/png' });
      await act(async () => { fireEvent.change(getFileInput(), { target: { files: [file] } }); });
      expect(mockPostDefaultImage).toHaveBeenCalledWith('/Users/x/site', 'src/components/FeaturedWork.astro', 0, { file });
      const receipt = mockTakeSnapshot.mock.calls.at(-1)?.[0] as { reverse: () => void; forward: () => void };
      receipt.reverse(); expect(mockPostDefaultImage).toHaveBeenLastCalledWith('/Users/x/site', 'src/components/FeaturedWork.astro', 0, { to: 'src/assets/old.png' });
      receipt.forward(); expect(mockPostDefaultImage).toHaveBeenLastCalledWith('/Users/x/site', 'src/components/FeaturedWork.astro', 0, { to: 'src/assets/new.png' });
      expect(mockWriteTagSwap).not.toHaveBeenCalled();
    });
    it('unavailable component usages are not an empty list and can retry', async () => {
      mockFetchUsages.mockRejectedValueOnce(new Error('private details')).mockResolvedValueOnce({ usages: [], contentUsages: [] });
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(await screen.findByText('Component usages are unavailable.')).toBeVisible();
      expect(screen.queryByText('No page usages found')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Retry usages' }));
      expect(await screen.findByText('No page usages found')).toBeVisible();
    });

    it.each(['replace', 'reset'])('acknowledged default %s retains its inverse after selection changes', async action => {
      let finish!: (value: { previous: string | null; asset: string }) => void;
      mockSelectedElement = { ...mockSelectedElement, boundAssetPath: '/Users/x/site/src/assets/sq-defaults/old.png' };
      mockPostDefaultImage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const { rerender } = renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      if (action === 'reset') fireEvent.click(screen.getByRole('button', { name: 'Reset default image' }));
      else fireEvent.change(getFileInput(), { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } });
      mockSelectedElement = { ...mockSelectedElement, key: 'other-image', ownerComponentFile: 'src/components/Other.astro' };
      rerender(<FillBlock classes="w-full" onClassesChange={vi.fn()} />);
      await act(async () => { finish({ previous: 'src/assets/old.png', asset: action === 'reset' ? '' : 'src/assets/new.png' }); });
      expect(mockTakeSnapshot).toHaveBeenCalledOnce();
      const receipt = mockTakeSnapshot.mock.calls[0][0] as { reverse: () => void; forward: () => void };
      receipt.reverse(); expect(mockPostDefaultImage).toHaveBeenLastCalledWith('/Users/x/site', 'src/components/FeaturedWork.astro', 0, { to: 'src/assets/old.png' });
      receipt.forward(); expect(mockPostDefaultImage).toHaveBeenLastCalledWith('/Users/x/site', 'src/components/FeaturedWork.astro', 0, action === 'reset' ? { clear: true } : { to: 'src/assets/new.png' });
      expect(screen.queryByText(/save needs checking/i)).toBeNull(); expect(mockWriteTagSwap).not.toHaveBeenCalled();
    });

    it('Reset default image writes clear:true', async () => {
      mockSelectedElement = {
        ...mockSelectedElement,
        boundAssetPath: '/Users/x/site/src/assets/sq-defaults/hero.jpg',
      };
      mockFetchUsages.mockResolvedValue({ usages: [], contentUsages: [] });
      mockPostDefaultImage.mockResolvedValue({ previous: 'src/assets/sq-defaults/old.jpg', asset: '' });
      renderBlock({ classes: 'w-full' }); fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Reset default image' }));
      await waitFor(() => {
        expect(mockPostDefaultImage).toHaveBeenCalledWith(
          '/Users/x/site', 'src/components/FeaturedWork.astro', 0, { clear: true },
        );
      });
      // previous default existed → snapshot registered for ⌘Z
      expect(mockTakeSnapshot).toHaveBeenCalled();
    });
  });

  describe('ordinary childless local container', () => {
    beforeEach(() => {
      mockLocalPath = '/Users/x/site'; mockProjectId = 'browser_lf_abc';
      mockSelectedElement = { key: 'source:div', tagName: 'div', sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 }, mediaFill: false, hasElementChildren: false };
    });
    it('offers background image controls without making a media slot', async () => {
      renderBlock({ classes: 'w-60 h-40' }); fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      expect(screen.getByRole('textbox', { name: 'Image URL' })).toHaveValue('');
      expect(mockWriteTagSwap).not.toHaveBeenCalled();
    });
    it('uploads into a background class and preserves the container', async () => {
      const onClassesChange = vi.fn(); renderBlock({ classes: 'w-60 h-40', onClassesChange }); fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
      fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
      await act(async () => { fireEvent.change(getFileInput(), { target: { files: [new File(['x'], 'new.png', { type: 'image/png' })] } }); });
      expect(onClassesChange).toHaveBeenCalledWith("w-60 h-40 bg-[url('/uploads/new.png')]"); expect(mockWriteTagSwap).not.toHaveBeenCalled();
    });
  });

  describe('WC media instance (mediaFill, non-local)', () => {
    beforeEach(() => {
      // The clicked DOM element carries the instance-CHILD key; the command
      // must target the instance ROOT (regression: WC drop was a silent no-op).
      mockSelectedElement = {
        key: 'inst-media-1:div-0', tagName: 'div', sourceLocation: null,
        mediaFill: true, hasElementChildren: false, imageAlt: null,
      };
    });

    it('Media tab auto-active with the instance dropzone', () => {
      renderBlock({ classes: 'w-full min-h-40' });
      expect(screen.getByText(/Drop image or video/i)).toBeInTheDocument();
    });

    it('drop dispatches RESOLVE_INSTANCE_MEDIA with sq-asset src, snapshot first', async () => {
      renderBlock({ classes: 'w-full min-h-40' });
      const zone = screen.getByText(/Drop image or video/i).closest('[role="button"]')!;
      const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      });
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: 'RESOLVE_INSTANCE_MEDIA', key: 'inst-media-1', kind: 'image', src: 'sq-asset:bg-asset-id',
        });
      });
      expect(mockTransferAsset).toHaveBeenCalledWith('bg-asset-id', file);
      expect(mockTakeSnapshot.mock.invocationCallOrder[0])
        .toBeLessThan(mockDispatch.mock.invocationCallOrder[0]);
    });

    it('Remove media dispatches kind none', () => {
      renderBlock({ classes: 'w-full min-h-40' });
      fireEvent.click(screen.getByRole('button', { name: /Remove media/i }));
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'RESOLVE_INSTANCE_MEDIA', key: 'inst-media-1', kind: 'none',
      });
    });
  });

  // task-141: drawn elements resolve via Fill→Media in all runtimes
  describe('drawn element media (doc-side)', () => {
    beforeEach(() => {
      mockSelectedElement = {
        key: 'drawn-abc123', tagName: 'div', sourceLocation: null,
        mediaFill: false, hasElementChildren: false, imageAlt: null,
      };
    });

    it('Media tab shows the drawn dropzone and Remove media action', () => {
      renderBlock({ classes: 'w-40 h-40' });
      fireEvent.click(screen.getByRole('button', { name: 'Media' }));
      expect(screen.getByText(/Drop image or video/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Remove media/i })).toBeInTheDocument();
    });

    it('drop uploads via uploadAsset, snapshots BEFORE dispatching RESOLVE_DRAWN_MEDIA', async () => {
      renderBlock({ classes: 'w-40 h-40' });
      fireEvent.click(screen.getByRole('button', { name: 'Media' }));
      const zone = screen.getByText(/Drop image or video/i).closest('[role="button"]')!;
      const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      });
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn-abc123', kind: 'image', src: 'sq-asset:bg-asset-id',
        });
      });
      expect(mockUploadAsset).toHaveBeenCalledWith(file);
      expect(mockTransferAsset).toHaveBeenCalledWith('bg-asset-id', file);
      // ⌘Z contract: snapshot taken before the doc mutation
      expect(mockTakeSnapshot.mock.invocationCallOrder[0])
        .toBeLessThan(mockDispatch.mock.invocationCallOrder[0]);
    });

    it('Remove media snapshots then dispatches kind none', () => {
      renderBlock({ classes: 'w-40 h-40' });
      fireEvent.click(screen.getByRole('button', { name: 'Media' }));
      fireEvent.click(screen.getByRole('button', { name: /Remove media/i }));
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'RESOLVE_DRAWN_MEDIA', key: 'drawn-abc123', kind: 'none',
      });
      expect(mockTakeSnapshot.mock.invocationCallOrder[0])
        .toBeLessThan(mockDispatch.mock.invocationCallOrder[0]);
    });
  });

  // task-144: WC/server img with a source key — same unified Media surface as
  // local mode; writes ride UPDATE_IMAGE_ATTRIBUTE doc overlay + class writer.
  describe('WC img — unified overlay surface (task-144)', () => {
    beforeEach(() => {
      mockProjectId = 'browser_proj-1';
      mockLocalPath = null;
      mockSelectedElement = {
        key: 'src/components/Hero.astro:5:1', tagName: 'img',
        sourceLocation: { file: 'src/components/Hero.astro', line: 5, column: 1 },
        imageSrc: 'sq-asset:A1', imageAlt: 'hero', imagePreviewDataUrl: 'data:image/png;base64,x',
        mediaFill: false, hasElementChildren: false,
      };
    });

    it('renders Media tab with preview + Replace image… + Delete', () => {
      renderBlock({ classes: '' });
      expect(screen.getByAltText('Current media')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Replace image…' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('empty src → Add image…, NO Delete (blank-slot rule)', () => {
      mockSelectedElement = { ...mockSelectedElement, imageSrc: null, imagePreviewDataUrl: null, imageAlt: null };
      renderBlock({ classes: '' });
      expect(screen.getByRole('button', { name: 'Add image…' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('Delete dispatches UPDATE_IMAGE_ATTRIBUTE src="" and syncs', () => {
      renderBlock({ classes: '' });
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(mockTakeSnapshot).toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:5:1', attribute: 'src', value: '',
      });
      expect(mockSyncImageAttr).toHaveBeenCalledWith('src/components/Hero.astro:5:1', 'src', '');
    });

    it('drop uploads via uploadImageFile and dispatches UPDATE_IMAGE_ATTRIBUTE with the returned src', async () => {
      renderBlock({ classes: '' });
      const zone = screen.getByText(/Drop image to replace/i).closest('[role="button"]')!;
      const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
      await act(async () => {
        fireEvent.drop(zone, { dataTransfer: { files: [file] } });
      });
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:5:1', attribute: 'src', value: 'sq-asset:new-1',
        });
      });
      expect(mockUploadImageFile).toHaveBeenCalledWith(expect.objectContaining({ file, projectId: 'browser_proj-1', pageId: 'page-1' }));
      expect(mockSyncImageAttr).toHaveBeenCalledWith('src/components/Hero.astro:5:1', 'src', 'sq-asset:new-1');
      expect(mockTakeSnapshot.mock.invocationCallOrder[0])
        .toBeLessThan(mockDispatch.mock.invocationCallOrder[0]);
    });

    it('alt blur dispatches UPDATE_IMAGE_ATTRIBUTE alt', () => {
      renderBlock({ classes: '' });
      const altInput = screen.getByPlaceholderText('Describe the image') as HTMLInputElement;
      fireEvent.change(altInput, { target: { value: 'new alt' } });
      fireEvent.blur(altInput);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:5:1', attribute: 'alt', value: 'new alt',
      });
      expect(mockSyncImageAttr).toHaveBeenCalledWith('src/components/Hero.astro:5:1', 'alt', 'new alt');
    });

    it('object-fit writes classes via onClassesChange (setObjectFit)', () => {
      const onClassesChange = vi.fn();
      renderBlock({ classes: 'object-fill', onClassesChange });
      fireEvent.click(screen.getByRole('button', { name: 'Cover' }));
      expect(onClassesChange).toHaveBeenCalledWith(expect.stringContaining('object-cover'));
    });

    it('URL field commits sanitized src on blur; invalid scheme rejected', () => {
      renderBlock({ classes: '' });
      const urlInput = screen.getByPlaceholderText('https://example.com/image.jpg') as HTMLInputElement;
      expect(urlInput.value).toBe('sq-asset:A1');
      fireEvent.change(urlInput, { target: { value: 'https://x.example/pic.png' } });
      fireEvent.blur(urlInput);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:5:1', attribute: 'src', value: 'https://x.example/pic.png',
      });

      mockDispatch.mockClear();
      fireEvent.change(urlInput, { target: { value: 'javascript:alert(1)' } });
      fireEvent.blur(urlInput);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('Loading toggle dispatches UPDATE_IMAGE_ATTRIBUTE loading', () => {
      renderBlock({ classes: '' });
      fireEvent.click(screen.getByRole('button', { name: 'Eager' }));
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:5:1', attribute: 'loading', value: 'eager',
      });
      expect(mockSyncImageAttr).toHaveBeenCalledWith('src/components/Hero.astro:5:1', 'loading', 'eager');
    });

    it('resolved WC Media instance child (el-… key) re-selects into this branch — dispatch targets the selected key', () => {
      mockSelectedElement = {
        ...mockSelectedElement, key: 'el-inst-1:img-0', sourceLocation: null,
      };
      renderBlock({ classes: '' });
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'el-inst-1:img-0', attribute: 'src', value: '',
      });
    });
  });
});
