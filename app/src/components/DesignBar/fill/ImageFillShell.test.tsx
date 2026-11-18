import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ImageFillShell } from './ImageFillShell';
import { ExceptionImageFillControls } from './ExceptionImageFillControls';
const entry = { name: 'src/photos/import.png', kind: 'image' as const, thumbUrl: 'blob:thumbnail', applySrc: null };
it('Escape restores focus and closes project images without a mutation or leaked thumbnails', async () => {
  const source = { list: vi.fn(async () => [entry]), upload: vi.fn(), dispose: vi.fn(), fileFor: vi.fn() };
  const choose = vi.fn(); const pick = vi.fn();
  render(<ImageFillShell ownerId="a" src="/image.png" preview={null} caption="Fill" onChooseFile={choose} assetSource={source} onPick={pick} />);
  const trigger = screen.getByRole('button', { name: 'Edit image Fill' });
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Project media' }));
  expect(await screen.findByRole('button', { name: 'Use import.png' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(trigger).toHaveFocus(); expect(source.dispose).toHaveBeenCalledExactlyOnceWith([entry]);
  expect(choose).not.toHaveBeenCalled(); expect(pick).not.toHaveBeenCalled();
});
it('a bound project pick reads bytes but cannot apply them after selection changes', async () => {
  let finish!: (file: File) => void;
  const source = { list: vi.fn(async () => [entry]), upload: vi.fn(), dispose: vi.fn(), fileFor: vi.fn(() => new Promise<File>(resolve => { finish = resolve; })) };
  const onFiles = vi.fn(async () => {});
  const props = { ownerId: 'a', src: '/old.png', preview: null, caption: 'Content image', dropText: 'Replace content image', busy: false, error: null, onFiles, assetSource: source, children: null };
  const { rerender } = render(<ExceptionImageFillControls {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' })); fireEvent.click(screen.getByRole('button', { name: 'Project media' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use import.png' }));
  expect(source.fileFor).toHaveBeenCalledExactlyOnceWith(entry);
  rerender(<ExceptionImageFillControls {...props} ownerId="b" />);
  await act(async () => { finish(new File(['x'], 'import.png', { type: 'image/png' })); });
  expect(onFiles).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Upload image' })).toBeNull();
});
it('a project list failure stays unavailable until a successful retry', async () => {
  const source = { list: vi.fn().mockRejectedValueOnce(new Error('private path')).mockResolvedValueOnce([]), upload: vi.fn() };
  render(<ImageFillShell ownerId="a" src="" preview={null} caption="Choose an image" onChooseFile={vi.fn()} assetSource={source} onPick={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit image Fill' })); fireEvent.click(screen.getByRole('button', { name: 'Project media' }));
  expect(await screen.findByText('Project images are unavailable.')).toBeVisible(); expect(screen.queryByText('No project images')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByText('No project images')).toBeVisible());
});
