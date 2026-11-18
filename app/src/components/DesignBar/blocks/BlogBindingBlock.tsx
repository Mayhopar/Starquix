/**
 * Blog Settings for a files-truth BlogSlot (task-240). A UI over the PAGE
 * CODE: the binding is read back from the page file (DesignBar's
 * useBlogBinding) and every change rewrites the page through bindLocalBlogSlot
 * (one journaled whole-file write, ⌘Z restores the bytes). No Yjs, no sidecar.
 * A fetch the parser cannot classify is shown as "wired by hand" and never
 * rewritten. On a page with several BlogSlots it edits the SELECTED one
 * (binding.slot, task-244 L18); Numbered is offered only with one slot (L17).
 */
import type { FC } from 'react';
import { Button, Field, Row } from '@/components/ui';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { useUndoContext } from '@/context/UndoContext';
import { getLocalPageFile } from '@/utils/localPageSync';
import { assignedCardFor, bindLocalBlogSlot, renderedCardOf } from '@/components/Editor/localBlogBind';
import { pickListingCard } from '@/components/Editor/localCardMove';
import { allCardAssignments, projectSourcesSnapshot, useCardTitleLockVersion } from '@/utils/cardTitleLock';
import { filterToken, PAGINATION_CHROME, parseFilterToken, sortFor, sortOptionsFor, UNBOUND, type BlogBinding, type BlogPagination, type BlogSort, type Schema } from '@/utils/blogBinding';

const PAGINATION_OPTIONS = [
  { value: 'none', label: 'None' }, { value: 'numbered', label: 'Numbered' }, { value: 'load-more', label: 'Load more' },
];

const SORT_LABELS: Record<BlogSort, string> = {
  'date-desc': 'Date (newest)', 'date-asc': 'Date (oldest)', 'title-asc': 'Title A-Z', 'title-desc': 'Title Z-A',
};

/** A settings row (culture.md): the label on the left edge, the control on the right. */
export const LabelRow: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Row title={label} size="sm" className="pl-1 pr-0 py-0.5" hover={false}
    right={[{ type: 'custom', unboxed: true, node: <div className="w-36">{children}</div> }]} />
);

interface Props {
  binding: BlogBinding | null;
  collections: ReadonlyArray<{ name: string; inferredFields?: Schema }>;
  /** The component library's built-ins (the pagination chrome the page imports). */
  builtIn: ReadonlyArray<ScannedComponent>;
}

export function BlogBindingBlock({ binding, collections, builtIn }: Props) {
  const localProjectPath = useLocalProjectPath();
  const { pushStructuralUndo, takeSnapshot, claimSnapshot } = useUndoContext();
  useCardTitleLockVersion(); // re-render when the cards / assignments change

  if (!binding || !binding.hasSlot || !localProjectPath) return null;
  if (binding.custom) {
    return <div className="pl-1 pr-8 pb-2 text-xs text-text-muted">This blog is wired by hand — edit its fetch in Source.</div>;
  }

  const schemaOf = (name: string | null): Schema => collections.find((c) => c.name === name)?.inferredFields ?? [];
  const schema = schemaOf(binding.collection);
  const sortOptions = sortOptionsFor(schema);
  const write = (next: BlogBinding) => {
    const pageFile = getLocalPageFile();
    if (!pageFile) return;
    // The pagination chrome the page imports comes from the library — the
    // writer materializes it into the project when missing.
    const kind = next.pagination.kind;
    const chromeComponent = kind === 'none' ? null : builtIn.find((c) => c.name === PAGINATION_CHROME[kind]) ?? null;
    void bindLocalBlogSlot({ pageFile, localProjectPath, pushUndo: pushStructuralUndo, binding: next, chromeComponent, slot: binding.slot });
  };
  const setPagination = (kind: string) => {
    const pageSize = binding.pagination.kind === 'none' ? 3 : binding.pagination.pageSize;
    const pagination: BlogPagination = kind === 'numbered' || kind === 'load-more' ? { kind, pageSize } : { kind: 'none' };
    write({ ...binding, pagination });
  };
  const bind = (name: string) => {
    if (!name) return write(UNBOUND);
    const next = schemaOf(name);
    write({
      ...binding,
      collection: name,
      sort: sortFor(next, binding.sort),
      filter: binding.filter && next.some((f) => f.name === binding.filter!.field && f.type === 'boolean') ? binding.filter : null,
      href: null, // the writer resolves the new collection's detail route
    });
  };

  // Nothing to bind to: say so — a bare "None" select reads as broken.
  if (collections.length === 0 && !binding.collection) {
    return <div className="pl-1 pr-8 pb-2 text-xs text-text-muted">No content collections found in this project (src/content/*). Add one in the Content tab.</div>;
  }
  const collectionOptions = [{ value: '', label: 'None' }, ...collections.map((c) => ({ value: c.name, label: c.name }))];
  const booleanFields = schema.filter((f) => f.type === 'boolean');
  // THIS listing's card (design cards-any-collection L21): picking one
  // rewires only this page; a card not set up for the collection is assigned
  // to it in the same gesture (one ⌘Z).
  const pageFile = getLocalPageFile();
  const assignments = allCardAssignments();
  const cards = [...assignments].filter(([, a]) => a.card).map(([file]) => file).sort();
  const pageSrc = pageFile ? projectSourcesSnapshot()[pageFile] ?? '' : '';
  const currentCard = binding.collection && pageFile ? renderedCardOf(pageFile, pageSrc, binding.slot) ?? assignedCardFor(binding.collection, pageFile, pageSrc, binding.slot) : null;
  const cardName = (file: string) => file.replace(/^.*\//, '').replace(/\.astro$/, '');
  // Picking a card sets it up for the collection in the same gesture — no
  // state the user has to act on, so no "not set up" wording (owner 2026-10-11).
  const cardLabel = cardName;
  const pickCard = (file: string) => {
    if (!binding.collection || !pageFile || !file || file === currentCard) return;
    void pickListingCard({ pageFile, cardFile: file, collection: binding.collection, fields: schema, current: assignments.get(file)?.collections[0] ?? null, takeSnapshot, claimSnapshot, slot: binding.slot });
  };

  return (
    <div className="pb-2 flex flex-col pr-8">
      <LabelRow label="Collection">
        <Field as="select" aria-label="Collection" value={binding.collection ?? ''} onChange={bind} options={collectionOptions} />
      </LabelRow>
      {binding.collection && (
        <>
          {cards.length > 0 && (
            <LabelRow label="Card">
              <Field
                as="select" aria-label="Card" value={currentCard ?? ''} onChange={pickCard}
                options={[...(currentCard ? [] : [{ value: '', label: 'Choose a card' }]), ...cards.map((f) => ({ value: f, label: cardLabel(f) }))]}
              />
            </LabelRow>
          )}
          {booleanFields.length > 0 && (
            <LabelRow label="Filter">
              <Field
                as="select" aria-label="Filter" value={filterToken(binding.filter)}
                onChange={(v) => write({ ...binding, filter: parseFilterToken(v) })}
                options={[{ value: '', label: 'All posts' }, ...booleanFields.flatMap((f) => [
                  { value: f.name, label: `Only ${f.name}` }, { value: `!${f.name}`, label: `Only not ${f.name}` },
                ])]}
              />
            </LabelRow>
          )}
          {sortOptions.length > 0 && (
            <LabelRow label="Sort">
              <Field
                as="select" aria-label="Sort" value={binding.sort ?? ''}
                onChange={(v) => write({ ...binding, sort: (v || null) as BlogSort | null })}
                options={sortOptions.map((s) => ({ value: s, label: SORT_LABELS[s] }))}
              />
            </LabelRow>
          )}
          <LabelRow label="Limit">
            <Field
              type="number" aria-label="Limit" value={binding.limit ?? ''} placeholder="All" min={1}
              onChange={(v) => write({ ...binding, limit: v === '' ? null : Math.max(1, parseInt(v, 10) || 1) })}
            />
          </LabelRow>
          <LabelRow label="Pagination">
            <Field
              as="select" aria-label="Pagination" value={binding.pagination.kind} onChange={setPagination}
              options={binding.slotCount > 1 ? PAGINATION_OPTIONS.filter((o) => o.value !== 'numbered') : PAGINATION_OPTIONS}
            />
          </LabelRow>
          {binding.pagination.kind !== 'none' && (
            <LabelRow label="Per page">
              <Field
                type="number" aria-label="Per page" value={binding.pagination.pageSize} min={1}
                onChange={(v) => binding.pagination.kind !== 'none' && write({ ...binding, pagination: { ...binding.pagination, pageSize: Math.max(1, parseInt(v, 10) || 1) } })}
              />
            </LabelRow>
          )}
          <LabelRow label="Post link">
            <span className="block text-xs text-text px-2 py-1 truncate" title={binding.href ? `${binding.href}[slug]` : 'No post page in this project'}>
              {binding.href ? `${binding.href}[slug]` : 'None'}
            </span>
          </LabelRow>
          <div className="pt-1">
            <Button variant="ghost" size="sm" label="Unbind" onClick={() => write(UNBOUND)} />
          </div>
        </>
      )}
    </div>
  );
}
