/**
 * Font family dropdown with live previews. Each row renders in its own font
 * (Google families via subsetted css2 preview links, project fonts via their
 * Dexie bytes, else the css2 link when Google has the name). "Project fonts"
 * = picked/uploaded fonts + every family the site's page loads itself.
 * "Upload font…" lives inside the list. The full catalog is
 * listed most-popular-first (catalog JSON is popularity-sorted), a page at a
 * time as the list scrolls; previews load lazily as rows scroll into view.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import fontCatalog from '@/assets/fontCatalog.json';
import { Popover, MenuItem, Button, FieldChevron, fieldTrigger } from '@/components/ui';
import { ensurePreviewFont, ensureProjectPreviewFont } from './fontPreview';
import { SYSTEM_FONT_VALUES, isSystemFontValue } from './fontFamilyClass';
import type { ProjectFontEntry } from '@/store/fontCommands';

const SYSTEM_FONTS = SYSTEM_FONT_VALUES.map(v => ({
  label: v.charAt(0).toUpperCase() + v.slice(1), value: v, className: `font-${v}`,
}));
const GOOGLE_NAMES = new Set(fontCatalog.families.map(f => f.f));
const NO_FONTS: string[] = [];
const PAGE = 50;

interface FontFamilySelectProps {
  value: string; // '' | 'sans'|'serif'|'mono' | family name
  projectFonts: Record<string, ProjectFontEntry>;
  /** Families the site's page loads itself (services/siteFonts). */
  siteFonts?: string[];
  /** No family class: the family the element renders with — shown dimmed, like Size's computed value. */
  inherited?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onUploadClick: () => void;
  /** Several elements selected with different families: the trigger reads "Mixed". */
  mixed?: boolean;
}

export const FontFamilySelect: React.FC<FontFamilySelectProps> = ({
  value: valueProp, projectFonts, siteFonts = NO_FONTS, inherited, disabled, onChange, onUploadClick, mixed = false,
}) => {
  // Mixed shows no family (nothing ticked, no preview font); picking one sets it on every member.
  const value = mixed ? '' : valueProp;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const projectNames = useMemo(
    () => [...new Set([...Object.keys(projectFonts), ...siteFonts])].sort(), [projectFonts, siteFonts]);

  // Full catalog, already popularity-sorted in the JSON, rendered PAGE rows at a
  // time: mounting all 1941 (each naming its own font) cost seconds per open.
  const [limit, setLimit] = useState(PAGE);
  const googleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fontCatalog.families
      .filter(f => (!q || f.f.toLowerCase().includes(q)) && !projectNames.includes(f.f))
      .map(f => f.f);
  }, [query, projectNames]);

  const filteredProjectNames = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? projectNames.filter(n => n.toLowerCase().includes(q)) : projectNames;
  }, [query, projectNames]);

  // Project fonts are few — load their previews eagerly on open.
  useEffect(() => {
    if (!isOpen) return;
    for (const name of filteredProjectNames) {
      void ensureProjectPreviewFont(name, projectFonts[name]?.assetIds[0]);
    }
  }, [isOpen, filteredProjectNames, projectFonts]);

  // Rows scrolling into view load their Google preview; the [data-more] row
  // renders the next page. Created by the first row that needs it — row refs
  // attach in the commit, before any effect runs. IO clips against ancestor
  // overflow, so root: null is correct even inside the scrolling popover.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const observeRow = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    observerRef.current ??= new IntersectionObserver((entries, observer) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const row = e.target as HTMLElement;
        observer.unobserve(row);
        if (row.dataset.more) setLimit(l => l + PAGE);
        else if (row.dataset.family) ensurePreviewFont(row.dataset.family);
      }
    }, { rootMargin: '100px' });
    observerRef.current.observe(el);
  }, []);
  // Closing (or unmounting) drops the rows' observations with them.
  useEffect(() => {
    if (isOpen) return () => { observerRef.current?.disconnect(); observerRef.current = null; };
  }, [isOpen]);

  // Preview the applied family on the closed button too.
  useEffect(() => {
    if (!value || isSystemFontValue(value)) return;
    if (projectFonts[value]) void ensureProjectPreviewFont(value, projectFonts[value].assetIds[0]);
    else ensurePreviewFont(value);
  }, [value, projectFonts]);

  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  const close = () => { setIsOpen(false); setQuery(''); setLimit(PAGE); };
  const pick = (v: string) => { close(); onChange(v); };

  const showInherited = !mixed && !value && !!inherited;
  const buttonLabel = mixed ? 'Mixed' : value
    ? (SYSTEM_FONTS.find(s => s.value === value)?.label ?? value)
    : (inherited || 'Default Font');

  // Google rows carry data-family + the IO ref (on a wrapper span — MenuItem
  // doesn't forward refs/data attrs) so their preview loads on
  // scroll-into-view; project rows are preloaded, no observer needed.
  const fontRow = (name: string, lazy = false) => (
    <span key={name} className="block" ref={lazy ? observeRow : undefined}
      data-family={lazy ? name : undefined} style={{ fontFamily: `"${name}"` }}>
      <MenuItem label={name} selected={value === name} onSelect={() => pick(name)} />
    </span>
  );

  return (
    <>
      <Button
        ref={triggerRef}
        variant="outline"
        disabled={disabled}
        onClick={() => setIsOpen(o => !o)}
        className={`${fieldTrigger} w-full pl-2 gap-1 justify-between text-sm`}
        iconRight={<FieldChevron />}
      >
        <span
          className={`flex-1 min-w-0 truncate text-left${showInherited ? ' text-text-secondary' : ''}`}
          style={value && !isSystemFontValue(value) ? { fontFamily: `"${value}"` } : undefined}
        >
          {buttonLabel}
        </span>
      </Button>

      <Popover isOpen={isOpen} onClose={close} triggerRef={triggerRef}
        placement="bottom-start" width="trigger" maxHeight={300}>
        <div className="py-1">
          <div className="px-1 pb-1">
            <input
              ref={searchRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setLimit(PAGE); }}
              placeholder={`Search ${fontCatalog.families.length} fonts…`}
              className="w-full h-6 px-2 bg-bg border border-stroke rounded-sm text-xs text-text outline-none"
            />
          </div>
          <div className="px-1">
            {!query && SYSTEM_FONTS.map(s => (
              <MenuItem key={s.value} label={s.label} selected={value === s.value}
                className={s.className} onSelect={() => pick(s.value)} />
            ))}
            {!query && (
              <MenuItem label="Upload font…" className="text-text-secondary"
                onSelect={() => { close(); onUploadClick(); }} />
            )}
            {filteredProjectNames.length > 0 && (
              <div className="px-2 pt-2 pb-0.5 text-3xs text-text-secondary uppercase">Project fonts</div>
            )}
            {filteredProjectNames.map(name => fontRow(name, !projectFonts[name]?.assetIds[0] && GOOGLE_NAMES.has(name)))}
            {googleRows.length > 0 && (
              <div className="px-2 pt-2 pb-0.5 text-3xs text-text-secondary uppercase">Google Fonts</div>
            )}
            {googleRows.slice(0, limit).map(name => fontRow(name, true))}
            {googleRows.length > limit && <span key={`more-${limit}`} ref={observeRow} data-more="1" className="block h-px" />}
            {query && googleRows.length === 0 && filteredProjectNames.length === 0 && (
              <div className="px-2 py-2 text-xs text-text-secondary">No fonts found</div>
            )}
          </div>
        </div>
      </Popover>
    </>
  );
};
