/**
 * REGRESSION (owner, 2026-08-11): "when i upload photo in content tab in media
 * component nothing happens, i keep seeing a placeholder".
 *
 * The dialog is the last surface between the file picker and the model write,
 * and it used to close on EVERY outcome:
 *
 *     void onUpload(file)
 *       .then(src => { onPick(src); onClose(); })     // even when src === ''
 *       .catch(e => setError(…))                      // 12px line, under the fold
 *
 * and `onPick` was typed `(src: string) => void`, so a model write the editor
 * refused (PostBodyEditor's `if (next != null)` guard) closed the dialog with no
 * statement at all. Both read to the user as "the app ignored me".
 *
 * The contract now: the dialog closes on SUCCESS ONLY, and every other outcome
 * states its reason in an unmissable alert.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MediaSlotDialog, EMPTY_UPLOAD_MESSAGE, MEDIA_REFUSAL_MESSAGE } from '../MediaSlotDialog';

function mount(overrides: {
  onUpload?: (f: File) => Promise<string>;
  onPick?: (src: string) => string | null;
  onClear?: (() => string | null) | null;
  currentSrc?: string;
} = {}) {
  const onPick = vi.fn(overrides.onPick ?? (() => null));
  const onClose = vi.fn();
  const onClear = overrides.onClear === undefined ? null : vi.fn(overrides.onClear);
  const { container } = render(
    <MediaSlotDialog
      currentSrc={overrides.currentSrc ?? ''}
      onUpload={overrides.onUpload ?? (async () => '/uploads/photo.png')}
      onPick={onPick}
      onClear={onClear}
      onClose={onClose}
    />,
  );
  const drop = async (name = 'photo.png') => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], name, { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  };
  return { onPick, onClose, onClear, drop };
}

/** The dialog is still usable — the user can retry without reopening it. */
const stillOpen = () => expect(screen.getByRole('button', { name: /try again|upload/i })).toBeTruthy();

describe('MediaSlotDialog — the write succeeds visibly or says why it did not', () => {
  it('writes and closes on a real upload', async () => {
    const { onPick, onClose, drop } = mount();
    await drop();

    expect(onPick).toHaveBeenCalledWith('/uploads/photo.png');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('treats an EMPTY src as a failure — never serializes it into the model', async () => {
    const { onPick, onClose, drop } = mount({ onUpload: async () => '' });
    await drop();

    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(EMPTY_UPLOAD_MESSAGE);
    stillOpen();
  });

  it('treats a whitespace-only src as a failure too', async () => {
    const { onPick, onClose, drop } = mount({ onUpload: async () => '   ' });
    await drop();

    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('keeps the dialog open and shouts when the upload rejects', async () => {
    const { onPick, onClose, drop } = mount({
      onUpload: async () => { throw new Error('413 Payload Too Large'); },
    });
    await drop();

    expect(onPick).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const alert = screen.getByRole('status');
    expect(alert.textContent).toContain('The media slot was not updated');
    expect(alert.textContent).not.toContain('413 Payload Too Large');
    expect(alert.textContent).toContain('The upload could not be completed');
    stillOpen();
  });

  it('keeps the dialog open when the MODEL write is refused', async () => {
    const refusal = "<DoubleImage/> doesn't take its media from an items list.";
    const { onClose, drop } = mount({ onPick: () => refusal });
    await drop();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(MEDIA_REFUSAL_MESSAGE);
    stillOpen();
  });

  it('offers a retry label once something failed', async () => {
    const { drop } = mount({ onUpload: async () => '' });
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy();
    await drop();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a second attempt after a failure can still succeed', async () => {
    let attempt = 0;
    const { onPick, onClose, drop } = mount({
      onUpload: async () => (++attempt === 1 ? '' : '/uploads/photo.png'),
    });
    await drop();
    expect(screen.getByRole('status')).toBeTruthy();
    await drop();

    expect(onPick).toHaveBeenCalledWith('/uploads/photo.png');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a refused CLEAR keeps the dialog open with the reason', async () => {
    const refusal = "<Media/>'s media list is written as code in the .mdx.";
    const { onClose } = mount({ currentSrc: '/uploads/photo.png', onClear: () => refusal });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain(MEDIA_REFUSAL_MESSAGE);
  });

  it('a successful clear closes', () => {
    const { onClose, onClear } = mount({ currentSrc: '/uploads/photo.png', onClear: () => null });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
