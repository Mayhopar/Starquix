import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeZipError } from '@/services/ThemeProcessor';

const undoDelete = vi.fn(async () => {});
const undo = vi.hoisted(() => ({ commit: vi.fn(), take: vi.fn() }));
vi.mock('@/context/UndoContext', () => ({ useOptionalUndoContext: () => ({ takeSnapshot: undo.take }) }));
const lib = {
  themes: [{ _id: 't1', name: 'Agency kit', slug: 'agency-kit', componentCount: 3, createdAt: '' }],
  activeTheme: 'starquix',
  setActiveTheme: vi.fn(async () => {}),
  deleteTheme: vi.fn(async () => undoDelete),
  uploadNewTheme: vi.fn(async () => 'new-id'),
};
vi.mock('@/context/ThemesLibraryContext', () => ({ useThemesLibrary: () => lib }));

import { ThemePicker, useThemeUpload } from '../ThemePicker';

function Harness() {
  const upload = useThemeUpload();
  return (
    <>
      <ThemePicker onUpload={upload.choose} uploading={upload.busy} />
      {upload.input}
      {upload.issue && <div role="alert">{upload.issue.title} {upload.issue.detail}</div>}
    </>
  );
}
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Theme: Starquix' }));
const pickZip = (file: File) => act(async () => {
  fireEvent.change(screen.getByTestId('theme-upload-input'), { target: { files: [file] } });
});

describe('ThemePicker (⌘K tab row)', () => {
  beforeEach(() => { vi.clearAllMocks(); lib.activeTheme = 'starquix'; });

  it('shows the active theme and lists built-ins, uploads and Upload theme… as menu items', () => {
    render(<Harness />);
    open();
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.replace(/\s+/g, ' ').trim())).toEqual(
      ['Starquix', 'Classic', 'Agency kit', 'Upload theme…']);
  });

  it('picking a theme saves it for the project', () => {
    render(<Harness />);
    open();
    fireEvent.click(screen.getByText('Classic'));
    expect(lib.setActiveTheme).toHaveBeenCalledWith('classic');
  });

  // Owner 2026-11-10: delete anything AND undo — the upload goes at once and ⌘Z brings it back (rows outside the doc).
  it('deleting an upload acts at once — no question — and ⌘Z / ⇧⌘Z replay it', async () => {
    undo.take.mockReturnValue(undo.commit);
    render(<Harness />);
    open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete Agency kit' })); });
    expect(lib.deleteTheme).toHaveBeenCalledWith('t1');
    expect(screen.queryByText('Delete Agency kit?')).toBeNull();
    expect(undo.commit).toHaveBeenCalledTimes(1);
    const [effect, , deferred] = undo.take.mock.calls[0] as [{ reverse: () => void; forward: () => void }, unknown, boolean];
    expect(deferred).toBe(true);
    effect.reverse(); expect(undoDelete).toHaveBeenCalledTimes(1);
    effect.forward(); expect(lib.deleteTheme).toHaveBeenCalledTimes(2);
  });

  it('a ZIP upload becomes the project theme; a non-ZIP gets an inline notice, nothing stored', async () => {
    render(<Harness />);
    await pickZip(new File(['x'], 'kit.txt', { type: 'text/plain' }));
    expect(screen.getByRole('alert')).toHaveTextContent('kit.txt was not added. Choose a ZIP file.');
    expect(lib.uploadNewTheme).not.toHaveBeenCalled();

    const zip = new File(['PK'], 'Agency kit 2.zip', { type: 'application/zip' });
    await pickZip(zip);
    expect(lib.uploadNewTheme).toHaveBeenCalledWith('Agency kit 2', zip);
    expect(lib.setActiveTheme).toHaveBeenCalledWith('upload:new-id');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a ZIP check\'s own reason, and never a raw storage/library error', async () => {
    lib.uploadNewTheme.mockRejectedValueOnce(new ThemeZipError('Too many files (501). Maximum is 500.'));
    render(<Harness />);
    await pickZip(new File(['PK'], 'big.zip'));
    expect(screen.getByRole('alert')).toHaveTextContent('big.zip was not added. Too many files (501). Maximum is 500.');

    lib.uploadNewTheme.mockRejectedValueOnce(new Error('QuotaExceededError: IDBDatabase 0x1f'));
    await pickZip(new File(['PK'], 'kit.zip'));
    expect(screen.getByRole('alert')).toHaveTextContent('kit.zip was not added. Check the ZIP and try again.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('IDBDatabase');
    expect(lib.setActiveTheme).not.toHaveBeenCalled();
  });
});
