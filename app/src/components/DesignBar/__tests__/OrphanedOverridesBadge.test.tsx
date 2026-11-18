/**
 * task-118 — orphaned-overrides badge: shows a count in the DesignBar header
 * when the selected element's astroSource has orphan records (hidden at 0,
 * ledger #31); popover lists each orphan by fingerprint with Keep/Discard.
 * Discard dispatches DISCARD_OVERRIDE_ORPHAN (undoable command, never a
 * direct Yjs mutation).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { OrphanedOverridesBadge } from '../OrphanedOverridesBadge';
import { getOrphansMap, type OverrideOrphan } from '@/store/overrideOrphans';

const h = vi.hoisted(() => ({
  doc: null as unknown as Y.Doc,
  dispatch: vi.fn(),
  takeSnapshot: vi.fn(),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useYjsValue: (sel: (doc: Y.Doc) => unknown) => sel(h.doc),
  useDispatch: () => h.dispatch,
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: h.takeSnapshot }),
}));

function seedOrphan(doc: Y.Doc, id: string, orphan: Partial<OverrideOrphan> = {}) {
  getOrphansMap(doc).set(id, {
    astroSource: 'Section.astro',
    instanceId: 'el-1',
    oldSelector: 'div-0',
    sqId: 'abc123',
    fingerprint: { tag: 'div', text: 'Welcome to the site', className: 'bg-primary text-white' },
    entries: [{ store: 'classOverrides', key: 'div-0', value: {} }],
    ...orphan,
  });
}

describe('OrphanedOverridesBadge', () => {
  beforeEach(() => {
    h.doc = new Y.Doc();
    h.dispatch.mockClear();
    h.takeSnapshot.mockClear();
  });

  it('hidden entirely at 0 orphans for the astroSource (#31)', () => {
    seedOrphan(h.doc, 'o-1', { astroSource: 'Other.astro' });
    const { container } = render(<OrphanedOverridesBadge astroSource="Section.astro" />);
    expect(container.firstChild).toBeNull();
  });

  it('hidden when no astroSource resolved', () => {
    seedOrphan(h.doc, 'o-1');
    const { container } = render(<OrphanedOverridesBadge astroSource={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the orphan count for the selected astroSource only', () => {
    seedOrphan(h.doc, 'o-1');
    seedOrphan(h.doc, 'o-2', { oldSelector: 'p-0' });
    seedOrphan(h.doc, 'o-3', { astroSource: 'Other.astro' });
    render(<OrphanedOverridesBadge astroSource="Section.astro" />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('popover row renders the fingerprint summary', () => {
    seedOrphan(h.doc, 'o-1');
    render(<OrphanedOverridesBadge astroSource="Section.astro" />);
    fireEvent.click(screen.getByRole('button', { name: /orphaned override/i }));
    expect(screen.getByText(/div · 'Welcome to/)).toBeInTheDocument();
    expect(screen.getByText(/bg-primary/)).toBeInTheDocument();
  });

  it('Discard dispatches DISCARD_OVERRIDE_ORPHAN after takeSnapshot', () => {
    seedOrphan(h.doc, 'o-1');
    render(<OrphanedOverridesBadge astroSource="Section.astro" />);
    fireEvent.click(screen.getByRole('button', { name: /orphaned override/i }));
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(h.takeSnapshot).toHaveBeenCalled();
    expect(h.dispatch).toHaveBeenCalledWith({ type: 'DISCARD_OVERRIDE_ORPHAN', orphanId: 'o-1' });
  });

  it('Keep closes the popover and the record stays', () => {
    seedOrphan(h.doc, 'o-1');
    render(<OrphanedOverridesBadge astroSource="Section.astro" />);
    fireEvent.click(screen.getByRole('button', { name: /orphaned override/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    expect(screen.queryByText(/div · 'Welcome to/)).not.toBeInTheDocument();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(getOrphansMap(h.doc).has('o-1')).toBe(true);
  });
});
