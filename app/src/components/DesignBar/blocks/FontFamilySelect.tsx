/**
 * Font family dropdown with live previews. Each row renders in its own font
 * (Google families via subsetted css2 preview links, project fonts via their
 * Dexie bytes). "Upload font…" lives inside the list. The full catalog is
 * listed most-popular-first (catalog JSON is popularity-sorted); previews
 * load lazily as rows scroll into view.
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

interface FontFamilySelectProps {
  value: string; // '' | 'sans'|'serif'|'mono' | family name
  projectFonts: Record<string, ProjectFontEntry>;
  disabled?: boolean;
  onChange: (value: string) => void;
  onUploadClick: () => void;
  /** Several elements selected with different families: the trigger reads "Mixed". */
  mixed?: boolean;
}

export const FontFamilySelect: React.FC<FontFamilySelectProps> = ({
  value: valueProp, projectFonts, disabled, onChange, onUploadClick, mixed = false,
}) => {
  // Mixed shows no family (nothing ticked, no preview font); picking one sets it on every member.
  const value = mixed ? '' : valueProp;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const projectNames = useMemo(() => Object.keys(projectFonts).sort(), [projectFonts]);

  // Full catalog, already popularity-sorted in the JSON. ponytail: 1941 plain
  // rows, no virtualization — previews are lazy so render cost is just DOM;
  // virtualize if the popover ever feels slow.
  const googleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fontCatalog.families
      .filter(f => (!q || f.f.toLowerCase().includes(q)) && !(f.f in projectFonts))
      .map(f => f.f);
  }, [query, projectFonts]);

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

  // Google previews load lazily as rows scroll into view (1941 rows — eager
  // loading would fire ~1900 stylesheet requests). IO clips against ancestor
  // overflow, so root: null is correct even inside the scrolling popover.
  const observerRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const family = (e.target as HTMLElement).dataset.family;
        if (family) ensurePreviewFont(family);
        observer.unobserve(e.target);
      }
    }, { rootMargin: '100px' });
    observerRef.current = observer;
    return () => { observer.disconnect(); observerRef.current = null; };
  }, [isOpen]);

  const observeRow = useCallback((el: HTMLElement | null) => {
    if (el) observerRef.current?.observe(el);
  }, []);

  // Preview the applied family on the closed button too.
  useEffect(() => {
    if (!value || isSystemFontValue(value)) return;
    if (projectFonts[value]) void ensureProjectPreviewFont(value, projectFonts[value].assetIds[0]);
    else ensurePreviewFont(value);
  }, [value, projectFonts]);

  useEffect(() => {
    if (isOpen) searchRef.current?.focus();
  }, [isOpen]);

  const close = () => { setIsOpen(false); setQuery(''); };
  const pick = (v: string) => { close(); onChange(v); };

  const buttonLabel = mixed ? 'Mixed' : value
    ? (SYSTEM_FONTS.find(s => s.value === value)?.label ?? value)
    : 'Default Font';

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
          className="flex-1 min-w-0 truncate text-left"
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
              onChange={e => setQuery(e.target.value)}
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
            {filteredProjectNames.map(name => fontRow(name))}
            {googleRows.length > 0 && (
              <div className="px-2 pt-2 pb-0.5 text-3xs text-text-secondary uppercase">Google Fonts</div>
            )}
            {googleRows.map(name => fontRow(name, true))}
            {query && googleRows.length === 0 && filteredProjectNames.length === 0 && (
              <div className="px-2 py-2 text-xs text-text-secondary">No fonts found</div>
            )}
          </div>
        </div>
      </Popover>
    </>
  );
};
