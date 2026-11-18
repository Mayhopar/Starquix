import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

const h = vi.hoisted(() => ({ doc: null as unknown as import('yjs').Doc, upload: vi.fn(), getUrl: vi.fn(), dispatch: vi.fn(), sync: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/assets/icons', async original => Object.fromEntries(Object.keys(await original<Record<string, unknown>>()).map(key => [key, () => null])));
vi.mock('@/store/hooks', () => ({ useYjsValue: (selector: (doc: Y.Doc) => unknown) => selector(h.doc), useDispatch: () => h.dispatch }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: h.snapshot }) }));
vi.mock('@/hooks/useAssetUpload', () => ({ useAssetUpload: () => ({ uploadAsset: vi.fn(), getAssetUrl: h.getUrl }) }));
// External file persistence and iframe transport; keep the mounted editor and validation real.
vi.mock('@/utils/imageUpload', () => ({ uploadImageFile: h.upload, syncImageAttrToIframe: h.sync }));
import { VideoBlock } from '../VideoBlock';

const props = { elementKey: 'video-a', videoSrc: '/previous.mp4', classes: '', onClassesChange: vi.fn() };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
function pick(container: HTMLElement, type = 'video/mp4') { fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['bytes'], 'clip.mp4', { type })] } }); }
beforeEach(() => { vi.clearAllMocks(); h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', 'project-a'); h.doc.getMap('meta').set('currentPageId', 'page-a'); h.getUrl.mockResolvedValue('blob:previous'); });

describe('VideoBlock finite feedback and operation ownership', () => {
  it('keeps an invalid URL draft and previous source without dispatching', () => {
    render(<VideoBlock {...props} />);
    const input = screen.getByPlaceholderText('https://example.com/video.mp4');
    fireEvent.change(input, { target: { value: 'javascript:secret()' } }); fireEvent.blur(input);
    expect(input).toHaveValue('javascript:secret()');
    expect(screen.getByText('Use a video URL with a supported scheme, such as https://.')).toBeVisible();
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.sync).not.toHaveBeenCalled();
  });
  it('shows curated upload feedback, keeps previous source and never auto-retries', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.upload.mockRejectedValue(new Error('SECRET /home/private?token=abc'));
    const { container } = render(<VideoBlock {...props} />); pick(container);
    expect(await screen.findByRole('status')).toHaveTextContent('Video upload could not finish');
    expect(container).not.toHaveTextContent('SECRET');
    expect(screen.getByPlaceholderText('https://example.com/video.mp4')).toHaveValue('/previous.mp4');
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.upload).toHaveBeenCalledTimes(1);
  });
  it('keeps file validation local and does not start an invalid upload', () => {
    const { container } = render(<VideoBlock {...props} />); pick(container, 'image/png');
    expect(screen.getByText('Only MP4 and WebM files are allowed')).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull(); expect(h.upload).not.toHaveBeenCalled();
  });
  it.each(['selection', 'project', 'unmount', 'draft'] as const)('does not apply a late upload after %s changes', async change => {
    const pending = deferred<{ src: string; previewUrl: string }>(); h.upload.mockReturnValue(pending.promise);
    const view = render(<VideoBlock {...props} />); pick(view.container);
    if (change === 'selection') view.rerender(<VideoBlock {...props} elementKey="video-b" videoSrc="/new.mp4" />);
    if (change === 'project') { h.doc.getMap('meta').set('projectId', 'project-b'); view.rerender(<VideoBlock {...props} videoSrc="/new.mp4" />); }
    if (change === 'unmount') view.unmount();
    if (change === 'draft') fireEvent.change(screen.getByPlaceholderText('https://example.com/video.mp4'), { target: { value: '/draft.mp4' } });
    await act(async () => pending.resolve({ src: '/uploaded.mp4', previewUrl: 'blob:uploaded' }));
    expect(h.dispatch).not.toHaveBeenCalled(); expect(h.sync).not.toHaveBeenCalled();
    if (change !== 'unmount') expect(screen.getByPlaceholderText('https://example.com/video.mp4')).toHaveValue(change === 'draft' ? '/draft.mp4' : '/new.mp4');
  });
  it('ignores a stale asset URL resolution after a new selection', async () => {
    const pending = deferred<string>(); h.getUrl.mockReturnValue(pending.promise);
    const view = render(<VideoBlock {...props} videoSrc="sq-asset:old" />);
    view.rerender(<VideoBlock {...props} elementKey="video-b" videoSrc="/new.mp4" />);
    await act(async () => pending.resolve('blob:old'));
    expect(screen.getByPlaceholderText('https://example.com/video.mp4')).toHaveValue('/new.mp4');
  });
  it('applies a valid upload through the existing attribute and iframe pipeline', async () => {
    h.upload.mockResolvedValue({ src: '/uploaded.mp4', previewUrl: 'blob:uploaded' });
    const { container } = render(<VideoBlock {...props} />); pick(container);
    await waitFor(() => expect(h.dispatch).toHaveBeenCalledWith({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'video-a', attribute: 'src', value: '/uploaded.mp4' }));
    expect(h.sync).toHaveBeenCalledWith('video-a', 'src', '/uploaded.mp4');
  });
});
