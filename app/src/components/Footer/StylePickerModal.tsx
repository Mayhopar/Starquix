/**
 * StylePickerModal — ⌘K-feel picker for AI style themes.
 * Shell = Modal size="picker" (shared with ComponentPickerModal). Right pane
 * renders a synthetic "what this theme generates" mock from
 * extractStylePreview (palette + font pulled out of the theme markdown) plus
 * the raw markdown. Selection is per-project (styleLibrary). Custom themes:
 * create/edit/delete (global). Footer mounts this only while open.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, SearchField, Row, Button, Field, Swatch } from '@/components/ui';
import { CheckIcon, PencilIcon, PlusIcon, TrashIcon } from '@/assets/icons';
import { markdownToHtml } from '@/utils/markdownToHtml';
import { useOptionalUndoContext } from '@/context/UndoContext';
import {
  listBundledThemes, listCustomThemes, saveCustomTheme, deleteCustomTheme, restoreCustomTheme,
  getActiveStyleId, setActiveStyleId, extractStylePreview, loadBundledThemes,
  type StyleTheme,
} from '@/ai/styles/styleLibrary';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onApplied: () => void; // Footer refreshes pill label
}

type RowItem =
  | { kind: 'none' }
  | { kind: 'header'; label: string }
  | { kind: 'theme'; ref: string; id: string; name: string; markdown: string; custom: boolean };

const isSelectable = (item: RowItem): boolean => item.kind !== 'header';

/** Black or white, whichever reads on the given hex background. */
function contrastText(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

/** Synthetic mini-page rendered from the theme's own palette + font. */
function ThemeResultMock({ markdown, name }: { markdown: string; name: string }) {
  const p = useMemo(() => extractStylePreview(markdown), [markdown]);
  if (!p) return null;
  const font = p.font ?? undefined;
  return (
    <div className="mb-3">
      <div className="rounded border border-stroke overflow-hidden" style={{ background: p.canvas }}>
        <div className="px-4 py-5">
          <div style={{ color: p.ink, fontFamily: font, fontSize: 19, fontWeight: 700, lineHeight: 1.15 }}>
            {name} — design beyond the grid
          </div>
          <div style={{ color: p.ink, opacity: 0.65, fontFamily: font, fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
            Hero copy, buttons and surfaces the AI will produce with this style active.
          </div>
          <span
            style={{
              background: p.primary, color: contrastText(p.primary), fontFamily: font,
              fontSize: 11, fontWeight: 600, padding: '5px 12px', borderRadius: 6,
              display: 'inline-block', marginTop: 12,
            }}
          >
            Get started
          </span>
        </div>
      </div>
      <div className="flex gap-1 mt-2">
        {p.swatches.map(hex => (
          <Swatch key={hex} color={hex} size="lg" title={hex} />
        ))}
      </div>
    </div>
  );
}

export const StylePickerModal: React.FC<Props> = ({ isOpen, onClose, projectId, onApplied }) => {
  const [search, setSearch] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [customs, setCustoms] = useState<StyleTheme[]>(listCustomThemes);
  const [bundled, setBundled] = useState<StyleTheme[]>(listBundledThemes);
  const [mode, setMode] = useState<'list' | { editingId?: string }>('list');
  const [formName, setFormName] = useState('');
  const [formMarkdown, setFormMarkdown] = useState('');
  const undo = useOptionalUndoContext();

  // Reset transient state and (re)load data each open; themes.json is lazy
  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setHighlightIndex(0);
    setMode('list');
    setCustoms(listCustomThemes());
    let live = true;
    loadBundledThemes().then(themes => { if (live) setBundled(themes); });
    return () => { live = false; };
  }, [isOpen]);

  const items = useMemo<RowItem[]>(() => {
    const q = search.trim().toLowerCase();
    const toRow = (t: StyleTheme, custom: boolean): RowItem =>
      ({ kind: 'theme', ref: `${custom ? 'custom' : 'bundled'}:${t.id}`, id: t.id, name: t.name, markdown: t.markdown, custom });
    const matching = (pool: StyleTheme[]) => pool.filter(t => !q || t.name.toLowerCase().includes(q));
    const customRows = matching(customs).map(t => toRow(t, true));
    const bundledRows = matching(bundled).map(t => toRow(t, false));
    return [
      { kind: 'none' as const },
      ...(customRows.length ? [{ kind: 'header' as const, label: 'Custom' }, ...customRows] : []),
      ...(bundledRows.length ? [{ kind: 'header' as const, label: 'Themes' }, ...bundledRows] : []),
    ];
  }, [search, customs, bundled]);

  // items[0] is always the selectable 'none' row, so 0 is a safe fallback
  const safeIndex = items[highlightIndex] && isSelectable(items[highlightIndex]) ? highlightIndex : 0;
  const highlighted = items[safeIndex];
  const activeRef = getActiveStyleId(projectId);

  const apply = (item: RowItem) => {
    if (!isSelectable(item)) return;
    setActiveStyleId(projectId, item.kind === 'theme' ? item.ref : null);
    onApplied();
    onClose();
  };

  const move = (dir: 1 | -1) => {
    let i = safeIndex;
    for (let step = 0; step < items.length; step++) {
      i = (i + dir + items.length) % items.length;
      if (isSelectable(items[i])) break;
    }
    setHighlightIndex(i);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && highlighted) { e.preventDefault(); apply(highlighted); }
  };

  const openForm = (theme?: { id: string; name: string; markdown: string }) => {
    setMode({ editingId: theme?.id });
    setFormName(theme?.name ?? '');
    setFormMarkdown(theme?.markdown ?? '');
  };

  const handleSave = () => {
    if (mode === 'list' || !formName.trim()) return;
    const saved = saveCustomTheme({ id: mode.editingId, name: formName.trim(), markdown: formMarkdown });
    setActiveStyleId(projectId, `custom:${saved.id}`);
    setCustoms(listCustomThemes());
    setMode('list');
    onApplied();
  };

  // At once — ⌘Z brings the style back (owner 2026-11-10: delete anything AND undo). It lives outside the doc
  // (localStorage), so the undo entry replays it as a side effect, committed right away (no doc transaction will).
  const handleDelete = (theme: { id: string; name: string }) => {
    const all = listCustomThemes();
    const index = all.findIndex(t => t.id === theme.id);
    const saved = all[index];
    const refresh = () => { setCustoms(listCustomThemes()); onApplied(); }; // active ref may dangle → no style
    const forward = () => { deleteCustomTheme(theme.id); refresh(); };
    forward();
    if (saved) undo?.takeSnapshot({ reverse: () => { restoreCustomTheme(saved, index); refresh(); }, forward }, undefined, true)?.();
  };

  const preview = useMemo(
    () => (highlighted?.kind === 'theme' ? markdownToHtml(highlighted.markdown) : null),
    [highlighted],
  );

  return (
    // Same shell as ComponentPickerModal (⌘K)
    <Modal isOpen={isOpen} onClose={onClose} aria-label="Style" size="picker">
      {mode === 'list' ? (
        <>
          {/* Search header — mirrors ⌘K */}
          <div className="px-4 py-2 border-b border-stroke flex items-center gap-2">
            <SearchField
              value={search}
              onChange={(v) => { setSearch(v); setHighlightIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Search styles…"
              autoFocus
              className="flex-1"
            />
            <Button variant="ghost" size="sm" icon={<PlusIcon className="w-4 h-4" />} label="New theme" onClick={() => openForm()} />
          </div>
          {/* Two-column body — mirrors ⌘K components tab */}
          <div className="flex flex-1 overflow-hidden">
            <div className="w-1/2 overflow-y-auto border-r border-stroke">
              {items.map((item, i) => {
                if (item.kind === 'header') {
                  return (
                    <Row
                      key={`header-${item.label}`}
                      title={item.label}
                      size="sm"
                      hover={false}
                      className="rounded-none px-4 mt-2"
                    />
                  );
                }
                const isActive = item.kind === 'theme' ? item.ref === activeRef : !activeRef;
                const right = [
                  ...(item.kind === 'theme' && item.custom
                    ? [
                        {
                          type: 'custom' as const,
                          showOnHover: true,
                          node: (
                            <Button iconOnly size="sm" variant="ghost" aria-label={`Edit ${item.name}`}
                              onClick={() => openForm(item)}
                              icon={<PencilIcon className="w-4 h-4" />} />
                          ),
                        },
                        {
                          type: 'custom' as const,
                          showOnHover: true,
                          node: (
                            <Button iconOnly size="sm" variant="ghost" aria-label={`Delete ${item.name}`}
                              onClick={() => handleDelete(item)}
                              icon={<TrashIcon className="w-4 h-4" />} />
                          ),
                        },
                      ]
                    : []),
                  ...(isActive ? [{ type: 'icon' as const, icon: <CheckIcon className="w-4 h-4" /> }] : []),
                ];
                return (
                  <Row
                    key={item.kind === 'theme' ? item.ref : 'none'}
                    title={item.kind === 'none' ? 'No style' : item.name}
                    selected={i === safeIndex}
                    right={right}
                    onClick={() => apply(item)}
                    className="rounded-none px-4"
                    rowProps={{ onMouseEnter: () => setHighlightIndex(i) }}
                  />
                );
              })}
            </div>
            <div className="w-1/2 overflow-y-auto px-4 py-2">
              {highlighted?.kind === 'theme' && preview ? (
                <>
                  <ThemeResultMock markdown={highlighted.markdown} name={highlighted.name} />
                  <div
                    className="text-2xs text-text-secondary leading-relaxed [&_h1]:text-sm [&_h1]:text-text [&_h2]:text-xs [&_h2]:text-text [&_h3]:text-2xs [&_h3]:text-text [&_code]:font-mono [&_pre]:overflow-x-auto"
                    dangerouslySetInnerHTML={{ __html: preview }}
                  />
                </>
              ) : (
                <div className="text-2xs text-text-secondary">No style — AI matches the page's existing design.</div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <Row title={mode.editingId ? 'Edit theme' : 'New theme'} className="pl-4 pr-2 border-b border-stroke" hover={false} />
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-2">
            <div>
              <Row title="Name" size="sm" className="px-0" hover={false} />
              <Field value={formName} onChange={setFormName} placeholder="My theme" aria-label="Theme name" />
            </div>
            <div>
              <Row title="Style guide" size="sm" className="px-0" hover={false} />
              <Field
                as="textarea"
                aria-label="Style guide"
                value={formMarkdown}
                onChange={setFormMarkdown}
                rows={12}
                placeholder="Markdown: palette, typography, spacing…"
                mono
              />
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-stroke px-4 py-2">
            <div className="flex-1" />
            <Button variant="ghost" size="md" label="Cancel" onClick={() => setMode('list')} />
            <Button variant="primary" size="md" label="Save" disabled={!formName.trim()} onClick={handleSave} />
          </div>
        </>
      )}
    </Modal>
  );
};
