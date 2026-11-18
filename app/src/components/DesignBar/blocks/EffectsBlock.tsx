/**
 * Effects Block - Dynamic effects list with add/remove
 *
 * Effects: Shadow, Blur, Background blur, Filter (all addable/removable)
 * Each effect type has its own controls
 */

import React, { useCallback, useMemo } from 'react';
import { findClass, setClass } from '../utils';
import { Field, Button } from '@/components/ui';
import { ColorPicker } from '../ColorPicker';
import { DeleteIcon } from '@/assets/icons';
import { useMixedValue, ownsGroups, type Owns } from '../multi/mixed';

// ============================================================================
// Types
// ============================================================================

type EffectType = 'shadow' | 'blur' | 'backdrop-blur' | 'filter';

interface Effect {
  id: string;
  type: EffectType;
  // Shadow-specific
  shadowSize?: string;
  shadowColor?: string;
  // Blur-specific
  blurSize?: string;
  // Backdrop blur-specific
  backdropBlurSize?: string;
  // Filter-specific
  grayscale?: boolean;
  invert?: boolean;
  sepia?: boolean;
  brightness?: string;
  contrast?: string;
  saturate?: string;
}

// ============================================================================
// Constants
// ============================================================================

const EFFECT_TYPE_OPTIONS = [
  { value: 'shadow', label: 'Shadow' },
  { value: 'blur', label: 'Blur' },
  { value: 'backdrop-blur', label: 'Background blur' },
  { value: 'filter', label: 'Filter' },
];

const SHADOW_SIZE_OPTIONS = [
  { value: 'sm', label: 'sm' },
  { value: '', label: 'default' },
  { value: 'md', label: 'md' },
  { value: 'lg', label: 'lg' },
  { value: 'xl', label: 'xl' },
  { value: '2xl', label: '2xl' },
];

const BLUR_SIZE_OPTIONS = [
  { value: 'sm', label: 'sm' },
  { value: 'DEFAULT', label: 'default' },
  { value: 'md', label: 'md' },
  { value: 'lg', label: 'lg' },
  { value: 'xl', label: 'xl' },
  { value: '2xl', label: '2xl' },
  { value: '3xl', label: '3xl' },
];

const BACKDROP_BLUR_SIZE_OPTIONS = [
  { value: 'sm', label: 'sm' },
  { value: 'DEFAULT', label: 'default' },
  { value: 'md', label: 'md' },
  { value: 'lg', label: 'lg' },
  { value: 'xl', label: 'xl' },
  { value: '2xl', label: '2xl' },
  { value: '3xl', label: '3xl' },
];

const BRIGHTNESS_OPTIONS = [
  { value: '', label: 'Normal' },
  { value: '0', label: '0' },
  { value: '50', label: '50' },
  { value: '75', label: '75' },
  { value: '90', label: '90' },
  { value: '95', label: '95' },
  { value: '105', label: '105' },
  { value: '110', label: '110' },
  { value: '125', label: '125' },
  { value: '150', label: '150' },
  { value: '200', label: '200' },
];

const CONTRAST_OPTIONS = [
  { value: '', label: 'Normal' },
  { value: '0', label: '0' },
  { value: '50', label: '50' },
  { value: '75', label: '75' },
  { value: '125', label: '125' },
  { value: '150', label: '150' },
  { value: '200', label: '200' },
];

const SATURATE_OPTIONS = [
  { value: '', label: 'Normal' },
  { value: '0', label: '0' },
  { value: '50', label: '50' },
  { value: '150', label: '150' },
  { value: '200', label: '200' },
];

// What the writers set and remove
const SHADOW_SIZE_RE = /^shadow(-none|-sm|-md|-lg|-xl|-2xl)?$/;
const SHADOW_NAMED_RE = /^shadow-(transparent|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d+)?$/;
const SHADOW_HEX_RE = /^shadow-\[#[0-9a-fA-F]+\]$/;

// Effect IDs are generated from type for stable React keys (each type can only appear once)
const generateEffectId = (type: EffectType) => `effect-${type}`;

// ============================================================================
// Parsing Helpers
// ============================================================================

const parseShadowSize = (classes: string): string | null => {
  if (findClass(classes, /^shadow-none$/)) return null;
  const sized = findClass(classes, /^shadow-(sm|md|lg|xl|2xl)$/);
  if (sized) {
    const match = sized.match(/^shadow-(.+)$/);
    return match ? match[1] : '';
  }
  if (findClass(classes, /^shadow$/)) return '';
  return null;
};

const parseShadowColor = (classes: string): string => {
  const hexToken = findClass(classes, SHADOW_HEX_RE);
  if (hexToken) return hexToken;

  const colorToken = findClass(classes, SHADOW_NAMED_RE);
  if (colorToken) return colorToken;

  return '';
};

const parseBlurSize = (classes: string): string | null => {
  if (findClass(classes, /^blur-none$/)) return null;
  const token = findClass(classes, /^blur-(sm|md|lg|xl|2xl|3xl)$/);
  if (token) {
    const match = token.match(/^blur-(.+)$/);
    return match ? match[1] : '';
  }
  if (findClass(classes, /^blur$/)) return 'DEFAULT';
  return null;
};

const parseBackdropBlurSize = (classes: string): string | null => {
  if (findClass(classes, /^backdrop-blur-none$/)) return null;
  const token = findClass(classes, /^backdrop-blur-(sm|md|lg|xl|2xl|3xl)$/);
  if (token) {
    const match = token.match(/^backdrop-blur-(.+)$/);
    return match ? match[1] : '';
  }
  if (findClass(classes, /^backdrop-blur$/)) return 'DEFAULT';
  return null;
};

const parseGrayscale = (classes: string): boolean => {
  if (findClass(classes, /^grayscale-0$/)) return false;
  if (findClass(classes, /^grayscale$/)) return true;
  return false;
};

const parseInvert = (classes: string): boolean => {
  if (findClass(classes, /^invert-0$/)) return false;
  if (findClass(classes, /^invert$/)) return true;
  return false;
};

const parseSepia = (classes: string): boolean => {
  if (findClass(classes, /^sepia-0$/)) return false;
  if (findClass(classes, /^sepia$/)) return true;
  return false;
};

const parseBrightness = (classes: string): string => {
  const token = findClass(classes, /^brightness-(\d+)$/);
  if (!token) return '';
  const match = token.match(/^brightness-(\d+)$/);
  return match ? match[1] : '';
};

const parseContrast = (classes: string): string => {
  const token = findClass(classes, /^contrast-(\d+)$/);
  if (!token) return '';
  const match = token.match(/^contrast-(\d+)$/);
  return match ? match[1] : '';
};

const parseSaturate = (classes: string): string => {
  const token = findClass(classes, /^saturate-(\d+)$/);
  if (!token) return '';
  const match = token.match(/^saturate-(\d+)$/);
  return match ? match[1] : '';
};

/** Check if any filter classes are present */
const hasFilterClasses = (classes: string): boolean => {
  return parseGrayscale(classes) || parseInvert(classes) || parseSepia(classes) ||
    !!parseBrightness(classes) || !!parseContrast(classes) || !!parseSaturate(classes);
};

/**
 * Strip responsive/state prefixes from classes for parsing
 * e.g., "lg:shadow-2xl md:blur-sm" -> "shadow-2xl blur-sm" // ui-lint-line: user-document class examples
 */
const stripPrefixes = (classes: string): string => {
  return classes
    .split(/\s+/)
    .map(cls => {
      // Remove responsive prefixes (sm:, md:, lg:, xl:, 2xl:)
      // Remove state prefixes (hover:, focus:, active:, disabled:)
      return cls.replace(/^(sm:|md:|lg:|xl:|2xl:|hover:|focus:|active:|disabled:)+/, '');
    })
    .join(' ');
};

/** Parse classes string into Effect array */
const parseEffects = (classes: string): Effect[] => {
  const effects: Effect[] = [];

  // Strip prefixes for parsing
  const strippedClasses = stripPrefixes(classes);

  const shadowSize = parseShadowSize(strippedClasses);
  if (shadowSize !== null) {
    effects.push({
      id: generateEffectId('shadow'),
      type: 'shadow',
      shadowSize,
      shadowColor: parseShadowColor(strippedClasses),
    });
  }

  const blurSize = parseBlurSize(strippedClasses);
  if (blurSize !== null) {
    effects.push({
      id: generateEffectId('blur'),
      type: 'blur',
      blurSize,
    });
  }

  const backdropBlurSize = parseBackdropBlurSize(strippedClasses);
  if (backdropBlurSize !== null) {
    effects.push({
      id: generateEffectId('backdrop-blur'),
      type: 'backdrop-blur',
      backdropBlurSize,
    });
  }

  // Check for filter effects
  if (hasFilterClasses(strippedClasses)) {
    effects.push({
      id: generateEffectId('filter'),
      type: 'filter',
      grayscale: parseGrayscale(strippedClasses),
      invert: parseInvert(strippedClasses),
      sepia: parseSepia(strippedClasses),
      brightness: parseBrightness(strippedClasses),
      contrast: parseContrast(strippedClasses),
      saturate: parseSaturate(strippedClasses),
    });
  }

  return effects;
};

// ============================================================================
// Class Generation Helpers
// ============================================================================

/** Generate shadow classes from effect */
const generateShadowClasses = (effect: Effect): string[] => {
  const classes: string[] = [];

  if (effect.shadowSize === '') {
    classes.push('shadow');
  } else if (effect.shadowSize) {
    classes.push(`shadow-${effect.shadowSize}`);
  }

  if (effect.shadowColor) {
    classes.push(effect.shadowColor);
  }

  return classes;
};

/** Generate blur class from effect */
const generateBlurClass = (effect: Effect): string => {
  if (effect.blurSize === 'DEFAULT') {
    return 'blur';
  }
  return effect.blurSize ? `blur-${effect.blurSize}` : '';
};

/** Generate backdrop blur class from effect */
const generateBackdropBlurClass = (effect: Effect): string => {
  if (effect.backdropBlurSize === 'DEFAULT') {
    return 'backdrop-blur';
  }
  return effect.backdropBlurSize ? `backdrop-blur-${effect.backdropBlurSize}` : '';
};

/** Generate filter classes from effect */
const generateFilterClasses = (effect: Effect): string[] => {
  const classes: string[] = [];

  if (effect.grayscale) classes.push('grayscale');
  if (effect.invert) classes.push('invert');
  if (effect.sepia) classes.push('sepia');
  if (effect.brightness && effect.brightness !== '100') classes.push(`brightness-${effect.brightness}`);
  if (effect.contrast && effect.contrast !== '100') classes.push(`contrast-${effect.contrast}`);
  if (effect.saturate && effect.saturate !== '100') classes.push(`saturate-${effect.saturate}`);

  return classes;
};


// ============================================================================
// Several selected — what each write owns (only those tokens change on every
// member, design §2). Shadow size and colour share Tailwind's `shadow-` group,
// so ownership is by the writers' own shapes.
// ============================================================================

const OWNS = {
  shadowSize: (t: string) => SHADOW_SIZE_RE.test(t),
  /** Named / hex as the writer removes them, plus a colour variable (`shadow-[var(--x)]`). */
  shadowColor: (t: string) => SHADOW_NAMED_RE.test(t) || SHADOW_HEX_RE.test(t) || /^shadow-\[(?:color:)?var\(--.+\)\]$/.test(t),
  blur: (t: string) => /^blur(-|$)/.test(t),
  backdropBlur: (t: string) => /^backdrop-blur(-|$)/.test(t),
  grayscale: (t: string) => /^grayscale(-|$)/.test(t),
  invert: (t: string) => /^invert(-|$)/.test(t),
  sepia: (t: string) => /^sepia(-|$)/.test(t),
  brightness: ownsGroups('brightness-'),
  contrast: ownsGroups('contrast-'),
  saturate: ownsGroups('saturate-'),
};
/** Every token of one effect type — Delete and Type change own these. */
const OWNS_TYPE: Record<EffectType, Owns> = {
  shadow: t => OWNS.shadowSize(t) || OWNS.shadowColor(t),
  blur: OWNS.blur,
  'backdrop-blur': OWNS.backdropBlur,
  filter: t => [OWNS.grayscale, OWNS.invert, OWNS.sepia, OWNS.brightness, OWNS.contrast, OWNS.saturate].some(owns => owns(t)),
};
/** A raw checkbox reads "Mixed" as indeterminate (design §2). */
const indeterminate = (on: boolean) => (el: HTMLInputElement | null) => { if (el) el.indeterminate = on; };

// ============================================================================
// Component
// ============================================================================

interface EffectsBlockProps {
  classes: string;
  /** Rows come from here; while ≥2 are selected it is the union of the members' classes (design C12). */
  fullClasses?: string;
  /** `owns` = the tokens this write owns (multi-select: only they change on each member). */
  onClassesChange: (classes: string, owns?: Owns) => void;
}

export const EffectsBlock: React.FC<EffectsBlockProps> = ({
  classes,
  fullClasses,
  onClassesChange
}) => {
  // Derive effects from classes (source of truth)
  // Use fullClasses if provided to show effects from all breakpoints
  const effectsSource = fullClasses || classes;
  const effects = useMemo(() => {
    const parsed = parseEffects(effectsSource);
    return parsed;
  }, [effectsSource]);

  // Several selected: each control compares its OWN reader across members (design C6).
  const mixed = {
    shadowSize: useMixedValue(parseShadowSize),
    shadowColor: useMixedValue(parseShadowColor),
    blur: useMixedValue(parseBlurSize),
    backdropBlur: useMixedValue(parseBackdropBlurSize),
    grayscale: useMixedValue(parseGrayscale),
    invert: useMixedValue(parseInvert),
    sepia: useMixedValue(parseSepia),
    brightness: useMixedValue(parseBrightness),
    contrast: useMixedValue(parseContrast),
    saturate: useMixedValue(parseSaturate),
  };

  // Remove effect by type
  const handleRemoveEffect = useCallback((effectType: EffectType) => {
    let newClasses = classes;
    switch (effectType) {
      case 'shadow':
        newClasses = setClass(newClasses, SHADOW_SIZE_RE, null);
        newClasses = setClass(newClasses, SHADOW_NAMED_RE, null);
        newClasses = setClass(newClasses, SHADOW_HEX_RE, null);
        break;
      case 'blur':
        newClasses = setClass(newClasses, /^blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl)?$/, null);
        break;
      case 'backdrop-blur':
        newClasses = setClass(newClasses, /^backdrop-blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl)?$/, null);
        break;
      case 'filter':
        newClasses = setClass(newClasses, /^grayscale(-0)?$/, null);
        newClasses = setClass(newClasses, /^invert(-0)?$/, null);
        newClasses = setClass(newClasses, /^sepia(-0)?$/, null);
        newClasses = setClass(newClasses, /^brightness-\d+$/, null);
        newClasses = setClass(newClasses, /^contrast-\d+$/, null);
        newClasses = setClass(newClasses, /^saturate-\d+$/, null);
        break;
    }
    onClassesChange(newClasses.trim(), OWNS_TYPE[effectType]);
  }, [classes, onClassesChange]);

  // Update effect type (remove old, add new)
  const handleTypeChange = useCallback((oldType: EffectType, newType: EffectType) => {
    let newClasses = classes;

    // Remove old type classes
    switch (oldType) {
      case 'shadow':
        newClasses = setClass(newClasses, SHADOW_SIZE_RE, null);
        newClasses = setClass(newClasses, SHADOW_NAMED_RE, null);
        newClasses = setClass(newClasses, SHADOW_HEX_RE, null);
        break;
      case 'blur':
        newClasses = setClass(newClasses, /^blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl)?$/, null);
        break;
      case 'backdrop-blur':
        newClasses = setClass(newClasses, /^backdrop-blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl)?$/, null);
        break;
      case 'filter':
        newClasses = setClass(newClasses, /^grayscale(-0)?$/, null);
        newClasses = setClass(newClasses, /^invert(-0)?$/, null);
        newClasses = setClass(newClasses, /^sepia(-0)?$/, null);
        newClasses = setClass(newClasses, /^brightness-\d+$/, null);
        newClasses = setClass(newClasses, /^contrast-\d+$/, null);
        newClasses = setClass(newClasses, /^saturate-\d+$/, null);
        break;
    }

    // Add default for new type
    switch (newType) {
      case 'shadow':
        newClasses = newClasses + ' shadow-sm'; // ui-lint-line: user-document class generation
        break;
      case 'blur':
        newClasses = newClasses + ' blur-sm';
        break;
      case 'backdrop-blur':
        newClasses = newClasses + ' backdrop-blur-sm';
        break;
      case 'filter':
        newClasses = newClasses + ' grayscale';
        break;
    }

    onClassesChange(newClasses.trim(), t => OWNS_TYPE[oldType](t) || OWNS_TYPE[newType](t));
  }, [classes, onClassesChange]);

  // Update shadow size
  const handleShadowSizeChange = useCallback((size: string) => {
    let newClasses = setClass(classes, SHADOW_SIZE_RE, null);
    if (size === '') {
      newClasses = newClasses + ' shadow';
    } else {
      newClasses = newClasses + ` shadow-${size}`;
    }
    onClassesChange(newClasses.trim(), OWNS.shadowSize);
  }, [classes, onClassesChange]);

  // Update shadow color
  const handleShadowColorChange = useCallback((colorClass: string) => {
    let newClasses = setClass(classes, SHADOW_NAMED_RE, null);
    newClasses = setClass(newClasses, SHADOW_HEX_RE, null);
    if (colorClass) {
      newClasses = newClasses + ` ${colorClass}`;
    }
    onClassesChange(newClasses.trim(), OWNS.shadowColor);
  }, [classes, onClassesChange]);

  // Update blur size
  const handleBlurSizeChange = useCallback((size: string) => {
    let newClasses = setClass(classes, /^blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl)?$/, null);
    if (size === 'DEFAULT') {
      newClasses = newClasses + ' blur';
    } else {
      newClasses = newClasses + ` blur-${size}`;
    }
    onClassesChange(newClasses.trim(), OWNS.blur);
  }, [classes, onClassesChange]);

  // Update backdrop blur size
  const handleBackdropBlurSizeChange = useCallback((size: string) => {
    let newClasses = setClass(classes, /^backdrop-blur(-none|-sm|-md|-lg|-xl|-2xl|-3xl)?$/, null);
    if (size === 'DEFAULT') {
      newClasses = newClasses + ' backdrop-blur';
    } else {
      newClasses = newClasses + ` backdrop-blur-${size}`;
    }
    onClassesChange(newClasses.trim(), OWNS.backdropBlur);
  }, [classes, onClassesChange]);

  // Filter handlers
  const handleGrayscaleChange = useCallback((checked: boolean) => {
    let newClasses = setClass(classes, /^grayscale(-0)?$/, null);
    if (checked) newClasses = newClasses + ' grayscale';
    onClassesChange(newClasses.trim(), OWNS.grayscale);
  }, [classes, onClassesChange]);

  const handleInvertChange = useCallback((checked: boolean) => {
    let newClasses = setClass(classes, /^invert(-0)?$/, null);
    if (checked) newClasses = newClasses + ' invert';
    onClassesChange(newClasses.trim(), OWNS.invert);
  }, [classes, onClassesChange]);

  const handleSepiaChange = useCallback((checked: boolean) => {
    let newClasses = setClass(classes, /^sepia(-0)?$/, null);
    if (checked) newClasses = newClasses + ' sepia';
    onClassesChange(newClasses.trim(), OWNS.sepia);
  }, [classes, onClassesChange]);

  const handleBrightnessChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^brightness-\d+$/, null);
    if (value && value !== '100') newClasses = newClasses + ` brightness-${value}`;
    onClassesChange(newClasses.trim(), OWNS.brightness);
  }, [classes, onClassesChange]);

  const handleContrastChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^contrast-\d+$/, null);
    if (value && value !== '100') newClasses = newClasses + ` contrast-${value}`;
    onClassesChange(newClasses.trim(), OWNS.contrast);
  }, [classes, onClassesChange]);

  const handleSaturateChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^saturate-\d+$/, null);
    if (value && value !== '100') newClasses = newClasses + ` saturate-${value}`;
    onClassesChange(newClasses.trim(), OWNS.saturate);
  }, [classes, onClassesChange]);

  return (
    <div className="pb-2">
      {/* Effects list */}
      {effects.map((effect) => (
        <div key={effect.id} className="pt-1">
          {/* Effect header row: type dropdown + delete */}
          <div className="flex items-center pr-1">
            <div className="flex-1">
              <Field
                as="select"
                aria-label="Effect type"
                value={effect.type}
                onChange={(val) => handleTypeChange(effect.type, val as EffectType)}
                options={EFFECT_TYPE_OPTIONS}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              onClick={() => handleRemoveEffect(effect.type)}
              aria-label="Remove effect"
              className="ml-1"
            >
              <DeleteIcon className="w-4 h-4" />
            </Button>
          </div>

          {/* Effect controls based on type */}
          <div className="pt-1 pr-8">
            {effect.type === 'shadow' && (
              <div className="grid grid-cols-2 gap-1">
                <ColorPicker
                  value={effect.shadowColor || ''}
                  mixed={mixed.shadowColor}
                  onChange={(colorClass) => handleShadowColorChange(colorClass)}
                  prefix="shadow"
                  placeholder="Black"
                />
                <Field
                  as="select"
                  aria-label="Shadow size"
                  mixed={mixed.shadowSize}
                  value={effect.shadowSize || 'sm'}
                  onChange={(val) => handleShadowSizeChange(val)}
                  options={SHADOW_SIZE_OPTIONS}
                />
              </div>
            )}

            {effect.type === 'blur' && (
              <Field
                as="select"
                aria-label="Blur size"
                mixed={mixed.blur}
                value={effect.blurSize || 'sm'}
                onChange={(val) => handleBlurSizeChange(val)}
                options={BLUR_SIZE_OPTIONS}
              />
            )}

            {effect.type === 'backdrop-blur' && (
              <Field
                as="select"
                aria-label="Background blur size"
                mixed={mixed.backdropBlur}
                value={effect.backdropBlurSize || 'sm'}
                onChange={(val) => handleBackdropBlurSizeChange(val)}
                options={BACKDROP_BLUR_SIZE_OPTIONS}
              />
            )}

            {effect.type === 'filter' && (
              <div className="space-y-1">
                {/* Toggle filters */}
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      ref={indeterminate(mixed.grayscale)}
                      checked={!mixed.grayscale && !!effect.grayscale}
                      onChange={(e) => handleGrayscaleChange(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span className="text-xs text-text">Grayscale</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      ref={indeterminate(mixed.invert)}
                      checked={!mixed.invert && !!effect.invert}
                      onChange={(e) => handleInvertChange(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span className="text-xs text-text">Invert</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      ref={indeterminate(mixed.sepia)}
                      checked={!mixed.sepia && !!effect.sepia}
                      onChange={(e) => handleSepiaChange(e.target.checked)}
                      className="cursor-pointer"
                    />
                    <span className="text-xs text-text">Sepia</span>
                  </label>
                </div>

                {/* Brightness */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-16">Brightness</span>
                  <Field
                    as="select"
                    aria-label="Brightness"
                    mixed={mixed.brightness}
                    value={effect.brightness || ''}
                    onChange={(val) => handleBrightnessChange(val)}
                    options={BRIGHTNESS_OPTIONS}
                    containerClassName="flex-1"
                  />
                </div>

                {/* Contrast */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-16">Contrast</span>
                  <Field
                    as="select"
                    aria-label="Contrast"
                    mixed={mixed.contrast}
                    value={effect.contrast || ''}
                    onChange={(val) => handleContrastChange(val)}
                    options={CONTRAST_OPTIONS}
                    containerClassName="flex-1"
                  />
                </div>

                {/* Saturate */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-16">Saturate</span>
                  <Field
                    as="select"
                    aria-label="Saturate"
                    mixed={mixed.saturate}
                    value={effect.saturate || ''}
                    onChange={(val) => handleSaturateChange(val)}
                    options={SATURATE_OPTIONS}
                    containerClassName="flex-1"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default EffectsBlock;
