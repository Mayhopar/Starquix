import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { EditorProvider, useEditorDoc } from '../EditorContext';

function EditingControl() {
  const doc = useEditorDoc();
  return <button>{doc.getMap('meta').get('currentBreakpoint') as string}</button>;
}
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('mounts editing controls only after a real durable transaction commits and leaves no probe rows', async () => {
  render(<EditorProvider><EditingControl /></EditorProvider>);
  expect(screen.queryByRole('button', { name: 'base' })).toBeNull();
  expect(await screen.findByRole('button', { name: 'base' })).toBeInTheDocument();
  expect(await db.durableEdits.count()).toBe(0);
  expect(await db.durableProjectState.count()).toBe(0);
  expect(await db.durableEditCheckpoints.count()).toBe(0);
});

it('keeps editing controls unmounted on a failed durable write and retries through scoped recovery', async () => {
  vi.spyOn(db.durableEdits, 'add').mockRejectedValueOnce(new DOMException('private storage details', 'QuotaExceededError'));
  render(<EditorProvider><EditingControl /></EditorProvider>);
  const recovery = await screen.findByRole('alert');
  expect(recovery).toHaveTextContent(/browser storage/i);
  expect(recovery).not.toHaveTextContent('private storage details');
  expect(screen.queryByRole('button', { name: 'base' })).toBeNull();
  expect(await db.durableProjectState.count()).toBe(0);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
  expect(await screen.findByRole('button', { name: 'base' })).toBeInTheDocument();
});
