/**
 * Owner 2026-09-30: "editor is not published — we need to make it look as
 * close as possible". The site's header shows description as the subtitle,
 * an author · date · reading-time byline and a 16:9 cover per header variant;
 * the writing view showed none of it (a 3:2 cover under the title only).
 */
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/core/collections/content-ops', () => ({ contentOps: { updatePost: vi.fn() } }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
vi.mock('../usePostPropertyImage', () => ({
  usePostPropertyImage: (value: string) => ({ url: value ? `blob:resolved/${value}` : null, unavailable: false }),
}));

import { FrontmatterForm } from '../FrontmatterForm';
import { DEFAULT_POST_HEADER } from '@/core/post/postHeaderView';
import type { CollectionField } from '@/core/collections/types';
import type { PostLayoutSettings } from '@/core/post/postLayoutProps';

const FIELDS: CollectionField[] = [
  { id: 'f-title', name: 'title', type: 'text', required: true },
  { id: 'f-description', name: 'description', type: 'text', required: false },
  { id: 'f-date', name: 'date', type: 'date', required: false },
  { id: 'f-image', name: 'image', type: 'image', required: false },
];
const FM = { title: 'A slow road', description: 'Five days, one paper map.', date: '2026-09-28', author: 'Ada', image: './cover.jpg' };

function mount(header: PostLayoutSettings = DEFAULT_POST_HEADER, frontmatter: Record<string, unknown> = FM) {
  const onChange = vi.fn();
  render(<FrontmatterForm frontmatter={frontmatter} fields={FIELDS} collectionId={null} postFile="src/content/blog/a.mdx" projectPath="wc://p"
    header={header} body={'word '.repeat(460)} onChange={onChange} onBlur={() => {}} />);
  return { onChange };
}

describe('FrontmatterForm — the header the page draws', () => {
  it('description is the subtitle, edited in place (it keeps its property row too)', () => {
    const { onChange } = mount();
    const sub = screen.getByRole('textbox', { name: 'Subtitle' });
    expect(sub).toHaveValue('Five days, one paper map.');
    fireEvent.change(sub, { target: { value: 'Six days.' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ description: 'Six days.' }));
    expect(screen.getByText('Description')).toBeTruthy();
  });
  it('byline = author · date · reading time', () => {
    mount();
    expect(document.querySelector('.sq-post-meta')?.textContent).toBe('Ada · Sep 28, 2026 · 2 min read');
  });
  it.each(['classic', 'centered'] as const)('%s cover sits under the byline', variant => {
    mount({ ...DEFAULT_POST_HEADER, header: variant });
    const cover = document.querySelector('img[data-sq-post-cover]')!;
    expect(cover.getAttribute('data-sq-post-cover')).toBe(variant);
    expect(document.querySelector('.sq-post-meta')!.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('cover header puts the image above the title', () => {
    mount({ ...DEFAULT_POST_HEADER, header: 'cover' });
    const cover = document.querySelector('img[data-sq-post-cover="cover"]')!;
    const title = document.querySelector('.sq-post-title')!;
    expect(cover.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('toggles off → no subtitle, no byline, no cover', () => {
    mount({ header: 'classic', toggles: { showSubtitle: false, showAuthor: false, showDate: false, showReadingTime: false, showCover: false } });
    expect(document.querySelector('.sq-post-subtitle')).toBeNull();
    expect(document.querySelector('.sq-post-meta')).toBeNull();
    expect(document.querySelector('img[data-sq-post-cover]')).toBeNull();
  });
});

/** Owner 2026-10-18: "clicking the date under the title edits it in place, and the Date row hides while the date shows there (like Title)". */
describe('FrontmatterForm — the byline date is edited where the page draws it', () => {
  function live(frontmatter: Record<string, unknown>, fields = FIELDS) {
    let latest = frontmatter; const onBlur = vi.fn();
    function Form() {
      const [value, setValue] = useState(frontmatter);
      return <FrontmatterForm frontmatter={value} fields={fields} collectionId={null} onChange={next => { latest = next; setValue(next); }} onBlur={onBlur} />;
    }
    render(<Form />);
    return { latest: () => latest, onBlur };
  }
  const bylineDate = () => document.querySelector('.sq-post-meta [role="button"]');
  it('hides the Date row while the byline shows the date; editing there writes the key', () => {
    const { latest, onBlur } = live({ title: 'T', date: '2026-09-28' });
    expect(screen.queryByText('Date')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit date' }));
    const input = screen.getByLabelText('date');
    expect(input).toHaveAttribute('type', 'date'); expect(input).toHaveValue('2026-09-28');
    fireEvent.change(input, { target: { value: '2026-10-01' } });
    expect(latest()).toEqual({ title: 'T', date: '2026-10-01' });
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Edit date' })).toHaveTextContent('Oct 1, 2026');
    expect(screen.queryByText('Date')).toBeNull();
  });
  it('commits nothing when closed unchanged; a cleared date stays in place until done, then returns to its row', () => {
    const { latest, onBlur } = live({ title: 'T', date: '2026-09-28' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit date' }));
    fireEvent.keyDown(screen.getByLabelText('date'), { key: 'Enter' });
    expect(onBlur).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit date' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Edit date' }));
    const input = screen.getByLabelText('date');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByLabelText('date')).toBe(input);
    expect(screen.queryByText('Date')).toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onBlur).toHaveBeenCalledTimes(1); expect(latest().date).toBe('');
    expect(bylineDate()).toBeNull();
    expect(screen.getByText('Date')).toBeInTheDocument();
  });
  it('keeps a full timestamp whole in a text field', () => {
    live({ title: 'T', date: '2026-09-09T14:30:15+02:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit date' }));
    expect(screen.getByRole('textbox', { name: 'date' })).toHaveValue('2026-09-09T14:30:15+02:00');
  });
  it('a value the editor cannot change safely stays plain text in the byline and keeps its row', () => {
    live({ title: 'T', date: '2026-09-28' }, FIELDS.map(f => f.name === 'date' ? { ...f, type: 'list' as const } : f));
    expect(document.querySelector('.sq-post-meta')).toHaveTextContent('Sep 28, 2026');
    expect(bylineDate()).toBeNull();
    expect(screen.getByRole('button', { name: /^Other properties/ })).toBeInTheDocument();
  });
  it('a date the byline does not draw keeps its row', () => {
    live({ title: 'T', date: '2026-09-28', hideDate: true });
    expect(bylineDate()).toBeNull();
    expect(screen.getByText('Date')).toBeInTheDocument();
  });
});
