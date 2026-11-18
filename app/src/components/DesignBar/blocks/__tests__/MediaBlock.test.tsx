/**
 * task-206: MediaBlock — count/width/style knobs write the <Media/>
 * invocation through saveMediaEdit; read-only fallback when there is no
 * write target (no rehype stamps, e.g. WC canvas).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/core/postmedia/saveMediaEdit', () => ({
  saveMediaEdit: vi.fn().mockResolvedValue('<Media items={["a"]} class="col-span-8" />'),
  readMediaInvocation: vi.fn().mockResolvedValue('<Media items={["a"]} class="col-span-8" />'),
}));
vi.mock('@/components/Canvas/reloadPreview', () => ({
  requestPreviewReload: vi.fn(),
}));
vi.mock('@/utils/imageUpload', () => ({
  uploadPostMediaFile: vi.fn().mockResolvedValue('/uploads/x.png'),
}));

import { saveMediaEdit, readMediaInvocation } from '@/core/postmedia/saveMediaEdit';
import { requestPreviewReload } from '@/components/Canvas/reloadPreview';
import { MediaBlock } from '../MediaBlock';

const WRITE = { write: { bodyLine: 5, bodyEnd: 5 } };
const POST = { collection: 'works', slug: 'p1' };

beforeEach(() => {
  vi.clearAllMocks();
  (saveMediaEdit as ReturnType<typeof vi.fn>)
    .mockResolvedValue('<Media items={["a"]} class="col-span-8" />');
  (readMediaInvocation as ReturnType<typeof vi.fn>)
    .mockResolvedValue('<Media items={["a"]} class="col-span-8" />');
});

async function renderLoaded() {
  const utils = render(<MediaBlock selection={WRITE} postTarget={POST} />);
  await waitFor(() => expect(readMediaInvocation).toHaveBeenCalled());
  return utils;
}

describe('MediaBlock', () => {
  it('count 2 → saveMediaEdit mutate grows items to 2 entries', async () => {
    await renderLoaded();
    fireEvent.click(await screen.findByTitle('2 items'));
    await waitFor(() => expect(saveMediaEdit).toHaveBeenCalled());
    const call = (saveMediaEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.collection).toBe('works');
    expect(call.slug).toBe('p1');
    expect(call.bodyLine).toBe(5);
    expect(call.mutate('<Media items={["a"]} class="col-span-8" />'))
      .toBe('<Media items={["a", null]} class="col-span-8" />');
  });

  it('width full → mutate writes col-span-full', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTitle('Full width'));
    await waitFor(() => expect(saveMediaEdit).toHaveBeenCalled());
    const call = (saveMediaEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.mutate('<Media items={["a"]} class="col-span-8" />'))
      .toBe('<Media items={["a"]} class="col-span-full" />');
  });

  it('gap field blur → mutate writes the gap prop', async () => {
    await renderLoaded();
    const gap = screen.getByLabelText('Gap');
    fireEvent.change(gap, { target: { value: '24' } });
    fireEvent.blur(gap);
    await waitFor(() => expect(saveMediaEdit).toHaveBeenCalled());
    const call = (saveMediaEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.mutate('<Media items={["a"]} class="col-span-8" />'))
      .toBe('<Media gap={24} items={["a"]} class="col-span-8" />');
  });

  it('successful save fires the preview reload', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTitle('2 items'));
    await waitFor(() => expect(requestPreviewReload).toHaveBeenCalled());
  });

  it('write null → controls disabled + read-only note', () => {
    render(<MediaBlock selection={{ write: null }} postTarget={POST} />);
    expect(screen.getByText('Open the post to edit this media')).toBeTruthy();
    expect(saveMediaEdit).not.toHaveBeenCalled();
    const btn = screen.getByTitle('2 items') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('demo mode (component viewer): knobs enabled, drive SET_MEDIA_DEMO, no write', async () => {
    const posted: unknown[] = [];
    const spy = (e: MessageEvent) => { if ((e.data as { type?: string })?.type === 'SET_MEDIA_DEMO_TO_IFRAME') posted.push(e.data); };
    window.addEventListener('message', spy);
    render(<MediaBlock selection={{ write: null }} postTarget={null} demo />);

    expect(screen.queryByText('Open the post to edit this media')).toBeNull();
    const two = screen.getByTitle('2 items') as HTMLButtonElement;
    expect(two.disabled).toBe(false);
    fireEvent.click(two);

    const gap = screen.getByLabelText('Gap');
    fireEvent.change(gap, { target: { value: '24' } });
    fireEvent.blur(gap);

    // 3 messages: mount-time count assert, count click, gap blur.
    await waitFor(() => expect(posted.length).toBe(3));
    expect((posted[0] as { payload: unknown }).payload).toEqual({ count: 2 });
    expect((posted[1] as { payload: unknown }).payload).toEqual({ count: 2 });
    expect((posted[2] as { payload: unknown }).payload).toEqual({ vars: { gap: 24 } });
    expect(saveMediaEdit).not.toHaveBeenCalled();
    window.removeEventListener('message', spy);
  });

  it('slot Replace: upload resolves → mutate edits that slot index', async () => {
    (readMediaInvocation as ReturnType<typeof vi.fn>)
      .mockResolvedValue('<Media items={["a.png", "b.png"]} class="col-span-8" />');
    const { container } = render(<MediaBlock selection={WRITE} postTarget={POST} projectId="local_abc" />);
    await waitFor(() => expect(readMediaInvocation).toHaveBeenCalled());

    fireEvent.click(await screen.findByLabelText('Replace slot 2'));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(saveMediaEdit).toHaveBeenCalled());
    const call = (saveMediaEdit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.mutate('<Media items={["a.png", "b.png"]} class="col-span-8" />'))
      .toBe('<Media items={["a.png", "/uploads/x.png"]} class="col-span-8" />');
  });
});
