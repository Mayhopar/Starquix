import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportProjectModal } from './ImportProjectModal';

vi.mock('@/services/projectImport/processFolder', () => ({
  entriesFromFileList: vi.fn(async () => [{ path: 'site/package.json', content: new Uint8Array() }]),
}));
vi.mock('@/services/projectImport/createFilesTruthProject', () => ({
  importFilesTruthProject: vi.fn(async () => ({ projectId: 'browser_x', fileCount: 1, skipped: 0 })),
}));

function pick(input: HTMLInputElement, paths = ['site/src/pages/index.astro']) {
  const files = paths.map((path) => {
    const file = new File(['x'], path.split('/').pop()!);
    Object.defineProperty(file, 'webkitRelativePath', { value: path });
    return file;
  });
  Object.defineProperty(input, 'files', { value: files });
  fireEvent.change(input);
}

describe('ImportProjectModal', () => {
  it('says what the import skips and its limits before a folder is picked', () => {
    render(<ImportProjectModal isOpen onClose={() => {}} onImported={() => {}} />);
    expect(screen.getByText('Import Astro project')).toBeInTheDocument();
    expect(screen.getByText(/Skips node_modules, \.git and build output\./)).toBeInTheDocument();
    expect(screen.getByText(/Up to 2,000 files \/ 500 MB\./)).toBeInTheDocument();
  });

  it('counts only the files the import keeps (#47)', () => {
    render(<ImportProjectModal isOpen onClose={() => {}} onImported={() => {}} />);
    pick(screen.getByTestId('import-folder-input') as HTMLInputElement,
      ['site/package.json', 'site/.gitignore', 'site/node_modules/a.js', 'site/node_modules/b.js', 'site/.git/HEAD', 'site/dist/index.html']);
    expect(screen.getByRole('button', { name: '2 files selected' })).toBeInTheDocument();
  });

  it('cannot be dismissed while the import runs (#29)', async () => {
    const { importFilesTruthProject } = await import('@/services/projectImport/createFilesTruthProject');
    let finish!: (result: { projectId: string; fileCount: number; skipped: number }) => void;
    vi.mocked(importFilesTruthProject).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    const onImported = vi.fn();
    render(<ImportProjectModal isOpen onClose={onClose} onImported={onImported} />);
    pick(screen.getByTestId('import-folder-input') as HTMLInputElement);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByRole('button', { name: /Importing…/ }); // the spinner adds 'Loading' to the name
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    finish({ projectId: 'browser_x', fileCount: 1, skipped: 0 });
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('browser_x'));
  });

  it('derives the project name from the picked folder and imports on confirm', async () => {
    const onImported = vi.fn();
    render(<ImportProjectModal isOpen onClose={() => {}} onImported={onImported} />);
    const input = screen.getByTestId('import-folder-input') as HTMLInputElement;
    expect(input.getAttribute('webkitdirectory')).not.toBeNull();
    pick(input);
    await waitFor(() => expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('site'));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('browser_x'));
  });

  it('Import is disabled until a folder is picked', () => {
    render(<ImportProjectModal isOpen onClose={() => {}} onImported={() => {}} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});

it('retains the selected folder after a quota failure and gives non-destructive retry guidance', async () => {
  const { importFilesTruthProject } = await import('@/services/projectImport/createFilesTruthProject');
  vi.mocked(importFilesTruthProject).mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'));
  const onImported = vi.fn();
  render(<ImportProjectModal isOpen onClose={() => {}} onImported={onImported} />);
  pick(screen.getByTestId('import-folder-input') as HTMLInputElement);
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await screen.findByText('Browser storage could not complete this action.');
  expect(screen.getByRole('status')).toHaveTextContent(/Browser storage could not complete this action/);
  expect(screen.getByRole('button', { name: '1 files selected' })).toBeEnabled();
  expect(screen.getByLabelText('Project name')).toHaveValue('site');
  expect(onImported).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(onImported).toHaveBeenCalledWith('browser_x'));
});

it('explains a folder read failure without exposing its raw cause or dropping the selected files', async () => {
  const { entriesFromFileList } = await import('@/services/projectImport/processFolder');
  vi.mocked(entriesFromFileList).mockRejectedValueOnce(new Error('<html> /Users/private/import token=secret'));
  const onImported = vi.fn();
  render(<ImportProjectModal isOpen onClose={() => {}} onImported={onImported} />);
  pick(screen.getByTestId('import-folder-input') as HTMLInputElement);
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await screen.findByText('The selected folder could not be read.');
  expect(screen.getByRole('status')).toHaveTextContent('The selected folder could not be read.');
  expect(screen.queryByText(/token=secret/)).toBeNull();
  expect(screen.getByLabelText('Project name')).toHaveValue('site');
  expect(screen.getByRole('button', { name: '1 files selected' })).toBeEnabled();
  expect(onImported).not.toHaveBeenCalled();
});
