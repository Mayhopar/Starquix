import { MoreIcon as SharedMoreIcon } from '@/assets/icons';
/**
 * Typography Block - Figma-style
 *
 * Controls for font family, size, weight, color, line height, letter spacing, and alignment.
 * Includes a three-dots menu for: text transform, decoration, overflow, whitespace.
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { findClass, setClass, parseClasses, cssColorToHex } from '../utils';
import { getClassesByGroup, removeClassesByGroup } from '@/core/classes/properties';
import { ColorPicker } from '../ColorPicker';
import { Field, FieldChevron, IconButton, Popover, Menu, MenuItem, OperationNotice, cx } from '@/components/ui';
import { resolveToClass } from '@/core/classes/vocabulary';
import { familyToClass, classesToFamily, stripFontFamilyClasses, isSystemFontValue } from './fontFamilyClass';
import { FontFamilySelect } from './FontFamilySelect';
import { pickGoogleFont } from '@/services/googleFonts';
import { isLocalProjectId } from '@/utils/localMode';
import { pickLocalGoogleFont, uploadLocalFont, updateLocalCustomFont, LOCAL_FONT_NO_HEAD_WARNING } from '@/utils/localFonts';
import { selectProjectFonts } from '@/store/fontSelectors';
import { useSiteFonts } from '@/services/siteFonts';
import { selectProjectId } from '@/store/selectors';
import { useYjsValue, useDispatch } from '@/store/hooks';
import { db, getAssetBlob } from '@/db';
import { transferAssetToIframe } from '@/utils/assetTransfer';
import fontCatalog from '@/assets/fontCatalog.json';
import { useAssetUpload } from '@/hooks/useAssetUpload';
import {
  validateFontFile, fontFormatForFile, familyFromFileName, buildCustomFontFaceCss,
} from '@/utils/fontValidation';
import {
  LineHeightIcon,
  LetterSpacingIcon,
  AlignLeftIcon,
  AlignCenterIcon,
  AlignRightIcon
} from '@/assets/icons';
import type { ComputedStyles } from '../../../context/SelectionContext';
import { useMixedValue, ownsGroups, type Owns } from '../multi/mixed';
import { OPACITY_SUFFIX } from '../classPatterns';

// ============================================================================
// Constants
// ============================================================================

// Labelled by their px size
const FONT_SIZES = [
  { label: '12', value: 'xs' },
  { label: '14', value: 'sm' },
  { label: '16', value: 'base' },
  { label: '18', value: 'lg' },
  { label: '20', value: 'xl' },
  { label: '24', value: '2xl' },
  { label: '30', value: '3xl' },
  { label: '36', value: '4xl' },
  { label: '48', value: '5xl' }
];

const FONT_WEIGHTS = [
  { label: 'Thin', value: 'thin' },
  { label: 'Light', value: 'light' },
  { label: 'Regular', value: 'normal' },
  { label: 'Medium', value: 'medium' },
  { label: 'Semibold', value: 'semibold' },
  { label: 'Bold', value: 'bold' },
  { label: 'Extra Bold', value: 'extrabold' },
  { label: 'Black', value: 'black' }
];

const LINE_HEIGHTS = [
  { label: 'None', value: 'none' },
  { label: 'Tight', value: 'tight' },
  { label: 'Snug', value: 'snug' },
  { label: 'Normal', value: 'normal' },
  { label: 'Relaxed', value: 'relaxed' },
  { label: 'Loose', value: 'loose' }
];

const LETTER_SPACINGS = [
  { label: 'Tighter', value: 'tighter' },
  { label: 'Tight', value: 'tight' },
  { label: 'Normal', value: 'normal' },
  { label: 'Wide', value: 'wide' },
  { label: 'Wider', value: 'wider' },
  { label: 'Widest', value: 'widest' }
];

// Three-dots menu options
const TEXT_TRANSFORMS = [
  { label: 'None', value: '' },
  { label: 'Uppercase', value: 'uppercase' },
  { label: 'Lowercase', value: 'lowercase' },
  { label: 'Capitalize', value: 'capitalize' }
];

const TEXT_DECORATIONS = [
  { label: 'None', value: '' },
  { label: 'Underline', value: 'underline' },
  { label: 'Line Through', value: 'line-through' },
  { label: 'Overline', value: 'overline' }
];

const TEXT_OVERFLOWS = [
  { label: 'None', value: '' },
  { label: 'Truncate', value: 'truncate' },
  { label: 'Ellipsis', value: 'text-ellipsis' },
  { label: 'Clip', value: 'text-clip' }
];

const WHITESPACES = [
  { label: 'Normal', value: '' },
  { label: 'Nowrap', value: 'whitespace-nowrap' },
  { label: 'Pre', value: 'whitespace-pre' },
  { label: 'Pre-line', value: 'whitespace-pre-line' },
  { label: 'Pre-wrap', value: 'whitespace-pre-wrap' },
  { label: 'Break Spaces', value: 'whitespace-break-spaces' }
];

// ============================================================================
// Helpers
// ============================================================================

const parseFontFamily = (classes: string): string => {
  // System tokens (font-sans) and project families (font-["Open_Sans"]) both
  // land in the same select; value = 'sans'|'serif'|'mono' or the family name.
  const fam = classesToFamily(classes);
  return fam ? fam.value : '';
};

// Which text-* token is the SIZE is the registry's call (text-[var(--x)] and
// text-[#hex] are colours — task-262), never a second regex here.
const TEXT_SIZE = 'standalone:textSize';

const parseFontSize = (classes: string): string =>
  getClassesByGroup(parseClasses(classes), TEXT_SIZE)[0]?.slice('text-'.length) ?? '';

const TEXT_VAR_COLOR = new RegExp(`^text-\\[(color:)?var\\(--.+\\)\\]${OPACITY_SUFFIX.source}`);

// Which font-* token is the WEIGHT is the registry's call too (font-[var(--x)]
// and font-[650] are weights, font-["Inter"] is a family).
const FONT_WEIGHT = 'standalone:fontWeight';

const weightToken = (classes: string): string | undefined =>
  getClassesByGroup(parseClasses(classes), FONT_WEIGHT)[0];

/** The weight token's suffix ('bold', '[650]', '[var(--heavy)]'); 'normal' for none. */
const parseFontWeight = (classes: string): string => weightToken(classes)?.slice('font-'.length) ?? 'normal';

/** Weight as the select reads it, with "no token" = the default (design C6: a missing token and an
 *  explicit default read the same); distinct arbitrary weights stay distinct. */
const readWeight = (classes: string): string => weightToken(classes) ?? 'font-normal';

const TEXT_NAMED_COLOR = new RegExp(`^text-(transparent|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\\d+)?${OPACITY_SUFFIX.source}`);
const TEXT_HEX_COLOR = new RegExp(`^text-\\[#[0-9a-fA-F]+\\]${OPACITY_SUFFIX.source}`);

/** What each control's write owns: while ≥2 are selected, only these tokens change on every member
 *  (design §2 "each write declares what it owns"). Colour = exactly what its writer removes. */
const OWNS = {
  family: ownsGroups('standalone:fontFamily'),
  color: (t: string) => TEXT_NAMED_COLOR.test(t) || TEXT_HEX_COLOR.test(t) || TEXT_VAR_COLOR.test(t),
  weight: ownsGroups(FONT_WEIGHT),
  size: ownsGroups(TEXT_SIZE),
  lineHeight: ownsGroups('leading-'),
  letterSpacing: ownsGroups('tracking-'),
  align: ownsGroups('standalone:textAlign'),
  transform: ownsGroups('standalone:textTransform'),
  decoration: ownsGroups('standalone:textDecoration'),
  overflow: ownsGroups('standalone:textOverflow'),
  whitespace: ownsGroups('standalone:whitespace'),
} satisfies Record<string, Owns>;

const parseTextColor = (classes: string): string => {
  // Check for CSS variable reference: text-[var(--name)] / text-[color:var(--name)]
  const varToken = findClass(classes, TEXT_VAR_COLOR);
  if (varToken) {
    return varToken;
  }

  // Check for arbitrary hex
  const hexToken = findClass(classes, TEXT_HEX_COLOR);
  if (hexToken) {
    return hexToken;
  }

  // Check for named colors (excluding text-left, text-center, etc.)
  const colorToken = findClass(classes, TEXT_NAMED_COLOR);
  if (colorToken) {
    return colorToken;
  }

  return '';
};

const parseLineHeight = (classes: string): string => {
  const token = findClass(classes, /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[.+\])$/);
  if (!token) return '';

  const match = token.match(/^leading-(.+)$/);
  return match ? match[1] : '';
};

const parseLetterSpacing = (classes: string): string => {
  const token = findClass(classes, /^tracking-(tighter|tight|normal|wide|wider|widest|\[.+\])$/);
  if (!token) return '';

  const match = token.match(/^tracking-(.+)$/);
  return match ? match[1] : '';
};

const parseTextAlign = (classes: string): string => {
  const token = findClass(classes, /^text-(left|center|right|justify)$/);
  if (!token) return '';

  const match = token.match(/^text-(.+)$/);
  return match ? match[1] : '';
};

const parseTextTransform = (classes: string): string => {
  if (findClass(classes, /^uppercase$/)) return 'uppercase';
  if (findClass(classes, /^lowercase$/)) return 'lowercase';
  if (findClass(classes, /^capitalize$/)) return 'capitalize';
  if (findClass(classes, /^normal-case$/)) return '';
  return '';
};

const parseTextDecoration = (classes: string): string => {
  if (findClass(classes, /^underline$/)) return 'underline';
  if (findClass(classes, /^line-through$/)) return 'line-through';
  if (findClass(classes, /^overline$/)) return 'overline';
  if (findClass(classes, /^no-underline$/)) return '';
  return '';
};

const parseTextOverflow = (classes: string): string => {
  if (findClass(classes, /^truncate$/)) return 'truncate';
  if (findClass(classes, /^text-ellipsis$/)) return 'text-ellipsis';
  if (findClass(classes, /^text-clip$/)) return 'text-clip';
  return '';
};

const parseWhitespace = (classes: string): string => {
  const token = findClass(classes, /^whitespace-(normal|nowrap|pre|pre-line|pre-wrap|break-spaces)$/);
  if (!token) return '';
  return token;
};

// ============================================================================
// Preset or typed value (weight, size, line height, letter spacing)
// ============================================================================

interface Preset { label: string; value: string }

/** What a field reads for a token suffix: its preset's label, else the arbitrary value as written
 *  (`[1.35]` → 1.35; a variable `[var(--x)]` → --x, `[number:650]` → 650). */
const presetText = (presets: Preset[], value: string) =>
  presets.find(p => p.value === value)?.label
    ?? value.replace(/^\[(.+)\]$/, '$1').replace(/^\w+:/, '').replace(/^var\((.+)\)$/, '$1');

/** Typed text → a Tailwind arbitrary value (`1.35` → `[1.35]`, `28px` → `[28px]`); null = not a value here. */
const typed = (re: RegExp, bareUnit: string, valid: (n: number) => boolean = () => true) => (text: string) => {
  const m = text.match(re);
  return m && valid(parseFloat(m[1])) ? `[${m[1]}${m[2] ?? bareUnit}]` : null;
};

/** Per field: what it reads for a suffix, and what a typed value writes. A bare line height is CSS's multiplier. */
const FIELDS = {
  weight: {
    presets: FONT_WEIGHTS,
    read: (v: string) => presetText(FONT_WEIGHTS, v),
    write: typed(/^(\d+)$/, '', n => n >= 1 && n <= 1000),
  },
  size: {
    presets: FONT_SIZES,
    read: (v: string) => presetText(FONT_SIZES, v).replace(/px$/, ''),
    // The vocabulary picks the scale token when there is one (16px / 1rem → base), else text-[Npx]
    write: (t: string) => {
      const m = t.match(/^(\d*\.?\d+)(px|rem|em)?$/);
      return m && parseFloat(m[1]) > 0 ? resolveToClass('text', parseFloat(m[1]), m[2] ?? 'px').slice('text-'.length) : null;
    },
  },
  lineHeight: {
    presets: LINE_HEIGHTS,
    read: (v: string) => (/^\d+$/.test(v) ? `${Number(v) * 4}px` : presetText(LINE_HEIGHTS, v)), // leading-6 = 1.5rem
    write: typed(/^(\d*\.?\d+)(px|rem|em|%)?$/, ''),
  },
  letterSpacing: {
    presets: LETTER_SPACINGS,
    read: (v: string) => presetText(LETTER_SPACINGS, v),
    write: typed(/^(-?\d*\.?\d+)(px|rem|em)?$/, 'px'),
  },
};

/** Pick a preset from the menu, or type any value: Enter / blur commits, Esc reverts, empty clears. */
const PresetField: React.FC<{
  field: (typeof FIELDS)[keyof typeof FIELDS];
  /** The token's suffix ('snug', '[1.35]'), '' for none. */
  value: string;
  onChange: (value: string) => void;
  mixed: boolean;
  'aria-label': string;
  icon?: React.ReactNode;
  placeholder?: string;
}> = ({ field, value, onChange, mixed, icon, placeholder, 'aria-label': ariaLabel }) => {
  const [draft, setDraft] = useState<string | null>(null); // non-null while focused
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const skipBlur = useRef(false); // Enter / Esc blur the input themselves
  const shown = field.read(value);
  const commit = (text: string) => {
    const t = text.trim();
    if (t === shown) return;
    const preset = field.presets.find(p => p.label.toLowerCase() === t.toLowerCase() || p.value === t);
    const next = t === '' ? '' : preset ? preset.value : field.write(t);
    if (next !== null) onChange(next);
  };
  return (
    <>
      <Field
        icon={icon}
        aria-label={ariaLabel}
        mixed={mixed && draft === null}
        value={draft ?? shown}
        placeholder={placeholder}
        onChange={setDraft}
        onFocus={() => setDraft(mixed ? '' : shown)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== 'Escape') return;
          skipBlur.current = true;
          if (e.key === 'Enter') commit(draft ?? '');
          setDraft(null);
          e.currentTarget.blur();
        }}
        onBlur={() => {
          if (!skipBlur.current && draft !== null) commit(draft);
          skipBlur.current = false;
          setDraft(null);
        }}
        trailing={
          <IconButton ref={menuRef} size="sm" aria-label={`${ariaLabel} options`} onClick={() => setOpen(!open)}
            className="w-4 h-4 bg-transparent hover:bg-transparent">
            <FieldChevron />
          </IconButton>
        }
      />
      <Menu isOpen={open} onClose={() => setOpen(false)} triggerRef={menuRef} placement="bottom-end">
        {field.presets.map(p => (
          <MenuItem key={p.value} label={p.label} selected={!mixed && p.value === value}
            onSelect={() => { onChange(p.value); setOpen(false); }} />
        ))}
      </Menu>
    </>
  );
};

// ============================================================================
// Three Dots Icon
// ============================================================================

const ThreeDotsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <SharedMoreIcon className={className} />
);

// ============================================================================
// Component
// ============================================================================

interface TypographyBlockProps {
  elementKey?: string | null;
  classes: string;
  computedStyles?: ComputedStyles | null;
  /** `owns` = the tokens this write owns (multi-select: only they change on each member). */
  onClassesChange: (classes: string, owns?: Owns) => void;
}

// Parse px value from computed style string (e.g., "18px" -> 18)
const parsePxValue = (value: string | undefined): number | null => {
  if (!value) return null;
  const match = value.match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
};


export const TypographyBlock: React.FC<TypographyBlockProps> = ({
  elementKey,
  classes,
  computedStyles,
  onClassesChange
}) => {
  const dispatch = useDispatch();
  const projectId = useYjsValue(selectProjectId);
  const projectFonts = useYjsValue(selectProjectFonts);
  const siteFonts = useSiteFonts(projectId || '');
  const [fontLoading, setFontLoading] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const [fontNotice, setFontNotice] = useState<'apply' | 'preview' | 'stylesheet' | 'settings' | null>(null);
  // Selection/class revisions invalidate class application. A successful font
  // write still belongs in its project's manifest after selection changes.
  const owner = useRef({ projectId, elementKey, classes, onClassesChange, projectRevision: 0, selectionRevision: 0, targetRevision: 0, operation: 0, mounted: true });
  if (owner.current.projectId !== projectId) owner.current.projectRevision++;
  if (owner.current.projectId !== projectId || owner.current.elementKey !== elementKey) owner.current.selectionRevision++;
  if (owner.current.projectId !== projectId || owner.current.elementKey !== elementKey || owner.current.classes !== classes || owner.current.onClassesChange !== onClassesChange) owner.current.targetRevision++;
  Object.assign(owner.current, { projectId, elementKey, classes, onClassesChange });
  useEffect(() => {
    owner.current.mounted = true;
    return () => { owner.current.mounted = false; owner.current.targetRevision++; owner.current.selectionRevision++; };
  }, []);
  const beginFontOperation = () => {
    const { projectRevision, selectionRevision, targetRevision } = owner.current;
    const operation = ++owner.current.operation;
    setFontLoading(true);
    setFontError(null);
    setFontNotice(null);
    return {
      projectCurrent: () => owner.current.projectRevision === projectRevision,
      selectionCurrent: () => owner.current.mounted && owner.current.projectRevision === projectRevision && owner.current.selectionRevision === selectionRevision && owner.current.operation === operation,
      current: () => owner.current.mounted && owner.current.projectRevision === projectRevision && owner.current.targetRevision === targetRevision && owner.current.operation === operation,
      finish: () => {
        if (owner.current.mounted && owner.current.projectRevision === projectRevision && owner.current.elementKey === elementKey && owner.current.operation === operation) setFontLoading(false);
      },
    };
  };
  const showLocalWarning = (warning: string | null) => {
    if (warning) console.warn('[TypographyBlock] Font stylesheet warning:', warning);
    if (warning === LOCAL_FONT_NO_HEAD_WARNING) setFontNotice('stylesheet');
  };
  const { uploadAsset } = useAssetUpload(projectId || '');
  const fontFileInputRef = useRef<HTMLInputElement>(null);
  // gap-61: local_ projects are files-truth — font bytes/css go into the
  // user's folder (utils/localFonts), never Dexie or sq-asset refs.
  const isLocal = isLocalProjectId(projectId || '');
  // ponytail: one file per family; multi-weight grouping when uploads are common
  // srcUrl set = local upload (the /fonts/… rebake handle); assetId set = WC.
  const [uploadedFont, setUploadedFont] = useState<{
    family: string; assetId: string; format: string; weight: number; variable: boolean;
    srcUrl?: string;
  } | null>(null);
  const uploadedFontRef = useRef(uploadedFont);
  uploadedFontRef.current = uploadedFont;
  useEffect(() => {
    setFontLoading(false);
    setFontError(null);
    setFontNotice(null);
    setUploadedFont(null);
  }, [projectId, elementKey]);

  // Parse all values using useMemo - with computed style fallbacks
  const {
    fontFamily,
    fontSize,
    fontSizePlaceholder,
    fontWeight,
    textColorClass,
    textColorComputedHex,
    lineHeight,
    letterSpacing,
    textAlign,
    textTransform,
    textDecoration,
    textOverflow,
    whitespace
  } = useMemo(() => {
    // No size class: the field's placeholder is the size the element renders with.
    const computedFontSizePx = parsePxValue(computedStyles?.fontSize);

    // No explicit text-* color class → the element still renders a color
    // (inherited / UA default). Surface it as an "inherited" swatch instead of
    // the transparent checkerboard (task-094 B4, mirrors the fontSize fallback).
    const textColorClass = parseTextColor(classes);
    const textColorComputedHex = !textColorClass ? cssColorToHex(computedStyles?.color) : null;

    return {
      fontFamily: parseFontFamily(classes),
      fontSize: parseFontSize(classes),
      fontSizePlaceholder: computedFontSizePx ? String(Math.round(computedFontSizePx)) : 'Size',
      fontWeight: parseFontWeight(classes),
      textColorClass,
      textColorComputedHex,
      lineHeight: parseLineHeight(classes),
      letterSpacing: parseLetterSpacing(classes),
      textAlign: parseTextAlign(classes),
      textTransform: parseTextTransform(classes),
      textDecoration: parseTextDecoration(classes),
      textOverflow: parseTextOverflow(classes),
      whitespace: parseWhitespace(classes)
    };
  }, [classes, computedStyles]);

  // Several selected: each control compares its OWN reader across members (design C6).
  const mixed = {
    family: useMixedValue(parseFontFamily),
    color: useMixedValue(parseTextColor),
    weight: useMixedValue(readWeight),
    size: useMixedValue(parseFontSize),
    lineHeight: useMixedValue(parseLineHeight),
    letterSpacing: useMixedValue(parseLetterSpacing),
    align: useMixedValue(parseTextAlign),
    transform: useMixedValue(parseTextTransform),
    decoration: useMixedValue(parseTextDecoration),
    overflow: useMixedValue(parseTextOverflow),
    whitespace: useMixedValue(parseWhitespace),
  };

  // No family class: name the family the element renders with when the picker lists it
  // (a generic or system stack stays "Default Font").
  const inheritedFamily = useMemo(() => {
    const first = (computedStyles?.fontFamily ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');
    return projectFonts[first] || siteFonts.includes(first) ? first : '';
  }, [computedStyles, projectFonts, siteFonts]);

  // Three-dots menu state (outside-click + Escape close handled by Popover)
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleFontFamilyChange = useCallback(async (value: string) => {
    const stripped = stripFontFamilyClasses(classes);
    owner.current.operation++;
    setFontError(null);
    setFontNotice(null);
    setFontLoading(false);

    // System families (or clearing) — plain class swap, old behavior.
    if (!value || isSystemFontValue(value)) {
      onClassesChange((value ? `${stripped} font-${value}` : stripped).trim(), OWNS.family);
      return;
    }

    // Already picked (google or custom) or loaded by the site itself — just write the class.
    if (projectFonts[value] || siteFonts.includes(value)) {
      onClassesChange(`${stripped} ${familyToClass(value)}`.trim(), OWNS.family);
      return;
    }

    const operation = beginFontOperation();
    let manifestSaved = false;
    try {
      const catEntry = fontCatalog.families.find(f => f.f === value);
      const preferred = [400, 500, 700].filter(w => catEntry?.w.includes(w));
      const weights = preferred.length ? preferred : [catEntry?.w[0] ?? 400];
      if (isLocal) {
        const { css, warning } = await pickLocalGoogleFont(projectId || '', value, weights);
        if (!operation.projectCurrent()) return;
        dispatch({ type: 'SET_PROJECT_FONT', family: value, entry: { source: 'google', css, assetIds: [] } });
        manifestSaved = true;
        if (operation.current()) showLocalWarning(warning);
      } else {
        const { css, assetIds } = await pickGoogleFont(value, weights, projectId || '');
        if (!operation.projectCurrent()) return;
        dispatch({ type: 'SET_PROJECT_FONT', family: value, entry: { source: 'google', css, assetIds } });
        manifestSaved = true;
        await Promise.all(assetIds.map(async (id) => {
          const row = await db.assets.get(id);
          if (row && operation.projectCurrent() && owner.current.mounted) await transferAssetToIframe(id, getAssetBlob(row));
        }));
      }
      if (operation.current()) onClassesChange(`${stripped} ${familyToClass(value)}`.trim(), OWNS.family);
    } catch (err) {
      console.error('[TypographyBlock] font pick failed:', err);
      if (operation.current()) setFontNotice(manifestSaved ? 'preview' : 'apply');
    } finally {
      operation.finish();
    }
  }, [classes, elementKey, onClassesChange, projectFonts, siteFonts, projectId, dispatch, isLocal]);

  const handleFontUpload = useCallback(async (file: File) => {
    const validationError = validateFontFile(file);
    if (validationError) { setFontError(validationError); return; }
    const operation = beginFontOperation();
    let manifestSaved = false;
    try {
      if (isLocal) {
        const up = await uploadLocalFont(projectId || '', file);
        if (!operation.projectCurrent()) return;
        dispatch({ type: 'SET_PROJECT_FONT', family: up.family, entry: { source: 'custom', css: up.css, assetIds: [] } });
        manifestSaved = true;
        if (!operation.current()) return;
        showLocalWarning(up.warning);
        onClassesChange(`${stripFontFamilyClasses(classes)} ${familyToClass(up.family)}`.trim(), OWNS.family);
        setUploadedFont({ family: up.family, assetId: '', format: up.format, weight: 400, variable: false, srcUrl: up.srcUrl });
        return;
      }
      const family = familyFromFileName(file.name);
      const format = fontFormatForFile(file.name);
      const { assetId } = await uploadAsset(file);
      if (!operation.projectCurrent()) return;
      const css = buildCustomFontFaceCss(family, assetId, 400, false, format);
      dispatch({ type: 'SET_PROJECT_FONT', family, entry: { source: 'custom', css, assetIds: [assetId] } });
      manifestSaved = true;
      if (owner.current.mounted) await transferAssetToIframe(assetId, file);
      if (!operation.current()) return;
      onClassesChange(`${stripFontFamilyClasses(classes)} ${familyToClass(family)}`.trim(), OWNS.family);
      setUploadedFont({ family, assetId, format, weight: 400, variable: false });
    } catch (err) {
      console.error('[TypographyBlock] font upload failed:', err);
      if (operation.current()) setFontNotice(manifestSaved ? 'preview' : 'apply');
    } finally {
      operation.finish();
    }
  }, [classes, elementKey, onClassesChange, uploadAsset, dispatch, isLocal, projectId]);

  // Settings follow the same uploaded font across unrelated class/callback edits.
  // Applying a font to an element still uses the stricter target revision above.
  const updateUploadedFont = useCallback(async (weight: number, variable: boolean) => {
    if (!uploadedFont || fontLoading) return;
    const operation = beginFontOperation();
    const settingsCurrent = () => operation.selectionCurrent() && uploadedFontRef.current === uploadedFont;
    try {
      let css: string;
      if (uploadedFont.srcUrl) {
        const font = { family: uploadedFont.family, format: uploadedFont.format, srcUrl: uploadedFont.srcUrl };
        ({ css } = await updateLocalCustomFont(projectId || '', font, weight, variable));
      } else {
        css = buildCustomFontFaceCss(uploadedFont.family, uploadedFont.assetId, weight, variable, uploadedFont.format);
      }
      if (!operation.projectCurrent()) return;
      dispatch({ type: 'SET_PROJECT_FONT', family: uploadedFont.family, entry: { source: 'custom', css, assetIds: uploadedFont.srcUrl ? [] : [uploadedFont.assetId] } });
      if (settingsCurrent()) setUploadedFont({ ...uploadedFont, weight, variable });
    } catch (err) {
      console.error('[TypographyBlock] font update failed:', err);
      if (settingsCurrent()) setFontNotice('settings');
    } finally {
      operation.finish();
    }
  }, [uploadedFont, fontLoading, dispatch, projectId, elementKey]);

  const handleFontSizeChange = useCallback((value: string) => {
    const kept = removeClassesByGroup(parseClasses(classes), TEXT_SIZE);
    onClassesChange([...kept, ...(value ? [`text-${value}`] : [])].join(' '), OWNS.size);
  }, [classes, onClassesChange]);

  const handleFontWeightChange = useCallback((value: string) => {
    const kept = removeClassesByGroup(parseClasses(classes), FONT_WEIGHT);
    onClassesChange([...kept, ...(value && value !== 'normal' ? [`font-${value}`] : [])].join(' '), OWNS.weight);
  }, [classes, onClassesChange]);

  const handleTextColorChange = useCallback((colorClass: string, hex: string) => {
    let newClasses = setClass(classes, TEXT_NAMED_COLOR, null);
    newClasses = setClass(newClasses, TEXT_HEX_COLOR, null);
    newClasses = setClass(newClasses, TEXT_VAR_COLOR, null);

    if (colorClass) {
      newClasses = newClasses + ` ${colorClass}`;
    }

    onClassesChange(newClasses.trim(), OWNS.color);
  }, [classes, onClassesChange]);

  const handleLineHeightChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[.+\])$/, null);

    if (value) {
      newClasses = newClasses + ` leading-${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.lineHeight);
  }, [classes, onClassesChange]);

  const handleLetterSpacingChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^tracking-(tighter|tight|normal|wide|wider|widest|\[.+\])$/, null);

    if (value) {
      newClasses = newClasses + ` tracking-${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.letterSpacing);
  }, [classes, onClassesChange]);

  const handleTextAlignChange = useCallback((align: string) => {
    let newClasses = setClass(classes, /^text-(left|center|right|justify)$/, null);

    if (align) {
      newClasses = newClasses + ` text-${align}`;
    }

    onClassesChange(newClasses.trim(), OWNS.align);
  }, [classes, onClassesChange]);

  // Three-dots menu handlers
  const handleTextTransformChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^(uppercase|lowercase|capitalize|normal-case)$/, null);

    if (value) {
      newClasses = newClasses + ` ${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.transform);
  }, [classes, onClassesChange]);

  const handleTextDecorationChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^(underline|line-through|overline|no-underline)$/, null);

    if (value) {
      newClasses = newClasses + ` ${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.decoration);
  }, [classes, onClassesChange]);

  const handleTextOverflowChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^(truncate|text-ellipsis|text-clip)$/, null);

    if (value) {
      newClasses = newClasses + ` ${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.overflow);
  }, [classes, onClassesChange]);

  const handleWhitespaceChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^whitespace-(normal|nowrap|pre|pre-line|pre-wrap|break-spaces)$/, null);

    if (value) {
      newClasses = newClasses + ` ${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.whitespace);
  }, [classes, onClassesChange]);

  const alignIcons: Record<string, React.FC<{ className?: string }>> = {
    left: AlignLeftIcon,
    center: AlignCenterIcon,
    right: AlignRightIcon
  };

  // Check if any advanced option is set
  const hasAdvancedOptions = textTransform || textDecoration || textOverflow || whitespace;

  return (
    <div className='pb-3 pr-8'>
      {/* Row 1: Font Family (full width) */}
      <div className="mb-1">
        <FontFamilySelect
          value={fontFamily}
          mixed={mixed.family}
          projectFonts={projectFonts}
          siteFonts={siteFonts}
          inherited={inheritedFamily}
          disabled={fontLoading}
          onChange={handleFontFamilyChange}
          onUploadClick={() => fontFileInputRef.current?.click()}
        />
        {fontError && (
          <div className="mt-1 text-3xs text-error">{fontError}</div>
        )}
        {fontNotice && <OperationNotice
          title={{ apply: 'Font could not be applied', preview: 'Font saved; preview could not update', stylesheet: 'Font saved; site appearance may differ', settings: 'Font settings could not be updated' }[fontNotice]}
          detail={{
            apply: 'Check the current font before choosing or uploading it again.',
            preview: 'The font is available in the project. Check the preview before applying it again.',
            stylesheet: 'The site layout needs to load the saved font stylesheet to use this font outside the editor.',
            settings: 'Check the current font settings before changing them again.',
          }[fontNotice]}
        />}
        <input
          ref={fontFileInputRef}
          type="file"
          accept=".woff2,.woff,.ttf,.otf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFontUpload(file);
            e.target.value = '';
          }}
        />
        {uploadedFont && (
          <div className="mt-1 flex items-center gap-2">
            <Field as="select"
              value={String(uploadedFont.weight)}
              onChange={(v) => updateUploadedFont(Number(v), uploadedFont.variable)}
              options={[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => ({ label: String(w), value: String(w) }))}
              disabled={uploadedFont.variable || fontLoading}
            />
            <label className="flex items-center gap-1 text-3xs text-text-muted whitespace-nowrap">
              <input
                type="checkbox"
                disabled={fontLoading}
                checked={uploadedFont.variable}
                onChange={(e) => updateUploadedFont(uploadedFont.weight, e.target.checked)}
              />
              Variable
            </label>
          </div>
        )}
      </div>

      {/* Row 2: Text Color (full width) */}
      <div className="mb-1">
        <ColorPicker
          value={textColorClass}
          onChange={handleTextColorChange}
          prefix="text"
          placeholder="Text Color"
          mixed={mixed.color}
          computedHex={textColorComputedHex ?? undefined}
          className="w-full"
        />
      </div>

      {/* Row 3: Weight + Size */}
      <div className="grid grid-cols-2 gap-1 mb-1">
        <PresetField
          field={FIELDS.weight}
          aria-label="Font weight"
          mixed={mixed.weight}
          value={fontWeight}
          onChange={handleFontWeightChange}
        />
        <PresetField
          field={FIELDS.size}
          aria-label="Font size"
          mixed={mixed.size}
          value={fontSize}
          onChange={handleFontSizeChange}
          placeholder={fontSizePlaceholder}
        />
      </div>

      {/* Row 4: Line Height + Letter Spacing (with icons) */}
      <div className="grid grid-cols-2 gap-1 mb-1">
        <PresetField
          field={FIELDS.lineHeight}
          icon={<LineHeightIcon className="w-4 h-4" />}
          aria-label="Line height"
          mixed={mixed.lineHeight}
          value={lineHeight}
          onChange={handleLineHeightChange}
          placeholder="Auto"
        />
        <PresetField
          field={FIELDS.letterSpacing}
          icon={<LetterSpacingIcon className="w-4 h-4" />}
          aria-label="Letter spacing"
          mixed={mixed.letterSpacing}
          value={letterSpacing}
          onChange={handleLetterSpacingChange}
          placeholder="0"
        />
      </div>

      {/* Row 5: Text Alignment (icon buttons) + Three Dots Menu */}
      <div className="flex gap-1">
        <div className="flex-1 flex border border-input-stroke rounded-sm overflow-hidden bg-input-fill">
          {['left', 'center', 'right'].map(align => {
            const Icon = alignIcons[align];
            return (
              <IconButton
                key={align}
                active={!mixed.align && textAlign === align}
                className={cx(
                  'flex-1 w-auto h-auto py-1.5 px-2 rounded-none',
                  (mixed.align || textAlign !== align) && 'bg-transparent text-text hover:text-text'
                )}
                onClick={() => handleTextAlignChange(textAlign === align ? '' : align)}
                title={`Align ${align}`}
              >
                <Icon className="w-4 h-4" />
              </IconButton>
            );
          })}
        </div>

        {/* Three Dots Menu Button */}
        <div className="relative">
          <IconButton
            ref={buttonRef}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            active={!!(hasAdvancedOptions || isMenuOpen)}
            className="w-auto h-auto p-1.5 border border-stroke"
            title="More options"
          >
            <ThreeDotsIcon className="w-4 h-4" />
          </IconButton>

          {/* Dropdown Menu */}
          <Popover
            isOpen={isMenuOpen}
            onClose={() => setIsMenuOpen(false)}
            triggerRef={buttonRef}
            placement="bottom-end"
            width={192}
            className="bg-bg-contrast py-1"
          >
              {/* Text Transform */}
              <div className="px-2 py-1">
                <span className="text-3xs text-text-secondary uppercase">Transform</span>
                <div className="flex gap-1 mt-1">
                  {TEXT_TRANSFORMS.map(opt => (
                    <IconButton
                      key={opt.value}
                      onClick={() => handleTextTransformChange(opt.value)}
                      active={!mixed.transform && textTransform === opt.value}
                      title={opt.label}
                      className={cx(
                        'flex-1 w-auto h-auto py-1 px-1 text-3xs',
                        (mixed.transform || textTransform !== opt.value) && 'bg-bg text-text hover:text-text'
                      )}
                    >
                      {opt.label === 'None' ? '-' : opt.label.charAt(0).toUpperCase()}
                    </IconButton>
                  ))}
                </div>
              </div>

              <div className="h-px bg-stroke my-1" />

              {/* Text Decoration */}
              <div className="px-2 py-1">
                <span className="text-3xs text-text-secondary uppercase">Decoration</span>
                <div className="mt-1">
                  <Field as="select"
                    aria-label="Text decoration"
                    mixed={mixed.decoration}
                    value={textDecoration}
                    onChange={handleTextDecorationChange}
                    options={TEXT_DECORATIONS}
                  />
                </div>
              </div>

              <div className="h-px bg-stroke my-1" />

              {/* Text Overflow */}
              <div className="px-2 py-1">
                <span className="text-3xs text-text-secondary uppercase">Overflow</span>
                <div className="mt-1">
                  <Field as="select"
                    aria-label="Text overflow"
                    mixed={mixed.overflow}
                    value={textOverflow}
                    onChange={handleTextOverflowChange}
                    options={TEXT_OVERFLOWS}
                  />
                </div>
              </div>

              <div className="h-px bg-stroke my-1" />

              {/* Whitespace */}
              <div className="px-2 py-1">
                <span className="text-3xs text-text-secondary uppercase">Whitespace</span>
                <div className="mt-1">
                  <Field as="select"
                    aria-label="Whitespace"
                    mixed={mixed.whitespace}
                    value={whitespace}
                    onChange={handleWhitespaceChange}
                    options={WHITESPACES}
                  />
                </div>
              </div>
          </Popover>
        </div>
      </div>
    </div>
  );
};

export default TypographyBlock;
