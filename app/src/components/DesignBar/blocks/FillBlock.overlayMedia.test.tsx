/**
 * FillBlock overlay media surface (no project path) — parity gaps 30/42
 * (+ 2/31 honest note).
 *
 * Before the fix, isOverlayImg gated the overlay unified media surface to
 * tagName === 'img': a source <video> fell through to the background-image
 * treatment and had NO replace surface at all. These tests pin:
 * - overlay <video> gets the unified Media surface (auto-active, tab-locked)
 * - accept matches the ELEMENT kind (video files only — no img↔video tag
 *   conversion here, that's a structural write and stays project-only)
 * - drops ride the SAME adapter as overlay img (uploadImageFile → sq-asset →
 *   UPDATE_IMAGE_ATTRIBUTE src + iframe sync), snapshot-first
 * - img-only extras (Alt, Loading) are hidden for video
 * - overlay img branch is unchanged (image accept, video files rejected)
 * - gaps 2/31: a childless container keeps the background treatment but
 *   SAYS the convert-to-media needs a local project (project open: no note)
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

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
// Mocks (mirrors FillBlock.test.tsx)
// ----------------------------------------------------------------------------

// Ordinary local containers use the shared Fill controls inside the editor's
// ClassStoreProvider; keep those controls real in this standalone harness.
const mockRegisterElement = vi.fn();
vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({ registerElement: mockRegisterElement }),
}));

const mockTakeSnapshot = vi.fn();
const mockUploadAsset = vi.fn(async (_file: File) => ({
  assetId: 'vid-asset-id',
  editorBlobUrl: 'blob:editor/vid',
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

let mockSelectedElement: Record<string, unknown> = {
  key: null, tagName: null, sourceLocation: null, mediaFill: false,
  hasElementChildren: false, imageAlt: null,
};
const mockSelect = vi.fn();
vi.mock('@/context/SelectionContext', () => ({
  useSelectedElement: () => mockSelectedElement,
  useSelectionContext: () => ({ select: mockSelect, patchSelection: vi.fn() }),
  useRectActions: () => ({ getSelectedRect: () => null, updateSelectionRect: vi.fn() }),
}));
let mockLocalPath: string | null = null;
vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => mockLocalPath,
}));
const mockWriteTagSwap = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/services/ViteMediaWriter', () => ({
  viteMediaWriter: { writeTagSwap: (...a: unknown[]) => mockWriteTagSwap(...a) },
}));
const mockUploadLocalAssetFile = vi.fn(async (_pid: string, file: File) => ({
  src: `/uploads/${file.name}`, previewUrl: `blob:local/${file.name}`,
}));
const mockSyncImageAttr = vi.fn();
const mockUploadImageFile = vi.fn(async (_p: unknown) => ({ src: 'sq-asset:new-vid-1', previewUrl: 'blob:editor/new-vid-1' }));
vi.mock('@/utils/imageUpload', () => ({
  uploadImageFile: (...a: unknown[]) => mockUploadImageFile(...a),
  uploadLocalAssetFile: (pid: string, f: File) => mockUploadLocalAssetFile(pid, f),
  syncImageAttrToIframe: (...a: unknown[]) => mockSyncImageAttr(...a),
  rebindLocalBoundAsset: vi.fn(),
  repointLocalBoundAsset: vi.fn(),
  makePlaceholderImageFile: async () => new File([new Uint8Array([1])], 'placeholder.png', { type: 'image/png' }),
  fetchComponentUsages: vi.fn(async () => ({ usages: [], contentUsages: [] })),
  postComponentDefaultImage: vi.fn(async () => ({ previous: null, asset: '' })),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot }),
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

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}));

vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({ pages: [], setActivePage: vi.fn() }),
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

const OVERLAY_VIDEO_ELEMENT = {
  key: 'src/components/Hero.astro:9:1', tagName: 'video',
  sourceLocation: { file: 'src/components/Hero.astro', line: 9, column: 1 },
  // The bridge scan reports imageSrc/preview for <img> ONLY — a real
  // video selection arrives without them (scanning.ts isImg gate).
  imageSrc: undefined, imageAlt: null, imagePreviewDataUrl: undefined,
  mediaFill: false, hasElementChildren: false,
};

describe('FillBlock — overlay video surface (gaps 30/42)', () => {
  beforeEach(() => {
    mockTakeSnapshot.mockReset();
    mockUploadAsset.mockClear();
    mockTransferAsset.mockClear();
    mockDispatch.mockClear();
    mockSyncImageAttr.mockClear();
    mockUploadImageFile.mockClear();
    mockUploadLocalAssetFile.mockClear();
    mockWriteTagSwap.mockClear();
    mockProjectId = 'browser_proj-1';
    mockPageId = 'page-1';
    mockLocalPath = null;
    setLocalComponentViewFile(null);
    mockSelectedElement = { ...OVERLAY_VIDEO_ELEMENT };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = vi.fn((blob: Blob) => `blob:mock/${(blob as Blob).size}`);
  });

  it('overlay <video> gets the unified Media surface (auto-active): replace + Delete, no background treatment', () => {
    renderBlock({ classes: 'w-full' });
    expect(screen.getByText('Drop video to replace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace video…' })).toBeInTheDocument();
    // bridge can't report a video src — Delete stays visible (writes src="")
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    // NOT the background-image treatment (the pre-fix fallthrough)
    expect(screen.queryByText(/Drop image or click to browse/i)).toBeNull();
  });

  it('accept matches the element kind: every file input takes video types only', () => {
    renderBlock({ classes: 'w-full' });
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.accept).toContain('video/mp4');
      expect(input.accept).not.toContain('image');
    }
  });

  it('hides the img-only extras (Alt, Loading) for video; keeps Fit/Position', () => {
    renderBlock({ classes: 'w-full' });
    expect(screen.queryByPlaceholderText('Describe the image')).toBeNull();
    expect(screen.queryByText('Loading')).toBeNull();
    expect(screen.getByText('Fit')).toBeInTheDocument();
  });

  it('is locked to the Media tab — clicking Solid keeps the video surface (no writeTagSwap without a project)', () => {
    renderBlock({ classes: 'w-full' });
    fireEvent.click(screen.getByRole('button', { name: 'Solid' }));
    expect(screen.getByText('Drop video to replace')).toBeInTheDocument();
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
  });

  it('drop rides the sq-asset adapter: uploadImageFile → UPDATE_IMAGE_ATTRIBUTE src + iframe sync, snapshot first', async () => {
    renderBlock({ classes: 'w-full' });
    const zone = screen.getByText('Drop video to replace').closest('[role="button"]')!;
    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    });
    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:9:1', attribute: 'src', value: 'sq-asset:new-vid-1',
      });
    });
    expect(mockUploadImageFile).toHaveBeenCalledWith(expect.objectContaining({
      file, projectId: 'browser_proj-1', pageId: 'page-1',
    }));
    expect(mockSyncImageAttr).toHaveBeenCalledWith('src/components/Hero.astro:9:1', 'src', 'sq-asset:new-vid-1');
    expect(mockTakeSnapshot.mock.invocationCallOrder[0])
      .toBeLessThan(mockDispatch.mock.invocationCallOrder[0]);
    // NEVER the project tag-swap writer here
    expect(mockWriteTagSwap).not.toHaveBeenCalled();
    expect(mockUploadLocalAssetFile).not.toHaveBeenCalled();
  });

  it('rejects image files on a video element (no tag conversion without a project)', async () => {
    renderBlock({ classes: 'w-full' });
    const zone = screen.getByText('Drop video to replace').closest('[role="button"]')!;
    const file = new File([new Uint8Array([1])], 'pic.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    });
    expect(screen.getByText(/Only MP4 and WebM/i)).toBeInTheDocument();
    expect(mockUploadImageFile).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('Delete dispatches UPDATE_IMAGE_ATTRIBUTE src="" and syncs', () => {
    renderBlock({ classes: 'w-full' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockTakeSnapshot).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'src/components/Hero.astro:9:1', attribute: 'src', value: '',
    });
    expect(mockSyncImageAttr).toHaveBeenCalledWith('src/components/Hero.astro:9:1', 'src', '');
  });

  it('overlay <img> branch is unchanged: image accept, video files rejected', async () => {
    mockSelectedElement = {
      ...OVERLAY_VIDEO_ELEMENT, tagName: 'img', imageSrc: 'sq-asset:A1', imageAlt: 'hero',
    };
    renderBlock({ classes: 'w-full' });
    expect(screen.getByText('Drop image to replace')).toBeInTheDocument();
    const zone = screen.getByText('Drop image to replace').closest('[role="button"]')!;
    const file = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    });
    expect(screen.getByText(/Only PNG, JPEG, GIF, WebP, and SVG/i)).toBeInTheDocument();
    expect(mockUploadImageFile).not.toHaveBeenCalled();
    // Alt + Loading render for img
    expect(screen.getByPlaceholderText('Describe the image')).toBeInTheDocument();
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });
});

describe('FillBlock — childless container honest note (gaps 2/31)', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockProjectId = 'browser_proj-1';
    mockPageId = 'page-1';
    mockLocalPath = null;
    setLocalComponentViewFile(null);
  });

  it('no project path, childless source <div>: Media tab keeps the background treatment + says convert needs a local project', () => {
    mockSelectedElement = {
      key: 'src/pages/index.astro:8:7', tagName: 'div',
      sourceLocation: { file: 'src/pages/index.astro', line: 8, column: 7 },
      mediaFill: false, hasElementChildren: false, imageAlt: null,
    };
    renderBlock({ classes: 'w-64 h-40' });
    fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    expect(screen.getByText(/Drop image or click to browse/i)).toBeInTheDocument();
    expect(screen.getByText(/needs a local project/i)).toBeInTheDocument();
  });

  it('no note for a container WITH children (nothing convertible to hide)', () => {
    mockSelectedElement = {
      key: 'src/pages/index.astro:8:7', tagName: 'div',
      sourceLocation: { file: 'src/pages/index.astro', line: 8, column: 7 },
      mediaFill: false, hasElementChildren: true, imageAlt: null,
    };
    renderBlock({ classes: 'w-64 h-40' });
    fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    expect(screen.getByText(/Drop image or click to browse/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs a local project/i)).toBeNull();
  });

  it('local childless container gets the shared background image controls — no note', () => {
    mockLocalPath = 'wc://browser_site';
    mockProjectId = 'browser_lf_abc';
    mockSelectedElement = {
      key: 'src/pages/index.astro:8:7', tagName: 'div',
      sourceLocation: { file: 'src/pages/index.astro', line: 8, column: 7 },
      mediaFill: false, hasElementChildren: false, imageAlt: null,
    };
    renderBlock({ classes: 'w-64 h-40' });
    fireEvent.click(screen.getByRole('tab', { name: 'Image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' }));
    expect(screen.getByRole('textbox', { name: 'Image URL' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Image URL' })).toBeEnabled();
    expect(screen.queryByText(/needs a local project/i)).toBeNull();
  });
});
