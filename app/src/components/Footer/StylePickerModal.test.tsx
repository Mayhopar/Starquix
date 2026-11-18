import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StylePickerModal } from './StylePickerModal';

const lib = vi.hoisted(() => ({
  listBundledThemes: () => [],
  loadBundledThemes: () => Promise.resolve([]),
  listCustomThemes: vi.fn(() => [{ id: 'c1', name: 'Mine', markdown: '# Mine' }]),
  saveCustomTheme: vi.fn(),
  deleteCustomTheme: vi.fn(),
  restoreCustomTheme: vi.fn(),
  getActiveStyleId: () => null,
  setActiveStyleId: vi.fn(),
  extractStylePreview: () => null,
}));
vi.mock('@/ai/styles/styleLibrary', () => lib);
const undo = vi.hoisted(() => ({ commit: vi.fn(), take: vi.fn() }));
vi.mock('@/context/UndoContext', () => ({ useOptionalUndoContext: () => ({ takeSnapshot: undo.take }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); lib.deleteCustomTheme.mockReset(); lib.restoreCustomTheme.mockReset(); undo.take.mockReset(); undo.commit.mockReset(); });

// Owner 2026-11-10: delete anything AND undo — no question; the style lives outside the doc, so its ⌘Z is a side effect.
it('deletes a custom style at once — no question, never a native confirm — and ⌘Z / ⇧⌘Z replay it', () => {
  const confirm = vi.spyOn(window, 'confirm');
  const onApplied = vi.fn();
  undo.take.mockReturnValue(undo.commit);
  render(<StylePickerModal isOpen onClose={() => {}} projectId="p" onApplied={onApplied} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete Mine' }));
  expect(lib.deleteCustomTheme).toHaveBeenCalledExactlyOnceWith('c1');
  expect(undo.commit).toHaveBeenCalledTimes(1);
  expect(onApplied).toHaveBeenCalled();
  expect(screen.queryByText('Delete Mine?')).toBeNull(); expect(confirm).not.toHaveBeenCalled();
  const [effect, , deferred] = undo.take.mock.calls[0] as [{ reverse: () => void; forward: () => void }, unknown, boolean];
  expect(deferred).toBe(true); // committed right after the delete: no doc transaction would commit it
  effect.reverse();
  expect(lib.restoreCustomTheme).toHaveBeenCalledWith({ id: 'c1', name: 'Mine', markdown: '# Mine' }, 0);
  effect.forward();
  expect(lib.deleteCustomTheme).toHaveBeenCalledTimes(2);
});
