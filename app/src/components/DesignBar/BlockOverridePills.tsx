import React, { useMemo, useCallback } from 'react';
import { STATE_PREFIXES, THEME_PREFIXES, BREAKPOINT_PREFIXES } from '@/core/classes/constants';
import { PrefixTag, type TagInfo, type TagCategory } from './PrefixTag';

const ALL_PREFIXES: { category: TagCategory; prefixes: readonly string[] }[] = [
  { category: 'breakpoint', prefixes: BREAKPOINT_PREFIXES },
  { category: 'theme', prefixes: THEME_PREFIXES },
  { category: 'state', prefixes: STATE_PREFIXES },
];

interface BlockOverridePillsProps {
  /** Full raw class string (all layers) */
  classes: string;
  /** Regex pattern to match tokens belonging to this block */
  blockPattern: RegExp;
  /** Called to remove prefixed classes matching the block pattern */
  onDeletePrefix?: (prefix: string, blockPattern: RegExp) => void;
}

export const BlockOverridePills: React.FC<BlockOverridePillsProps> = ({ classes, blockPattern, onDeletePrefix }) => {
  const pills = useMemo(() => {
    if (!classes) return [];
    const found: TagInfo[] = [];
    const tokens = classes.split(/\s+/);

    for (const { category, prefixes } of ALL_PREFIXES) {
      for (const prefix of prefixes) {
        const prefixStr = prefix + ':';
        const hasOverride = tokens.some(t => {
          if (!t.includes(prefixStr)) return false;
          const base = t.replace(/^(?:[\w-]+:)*/, '');
          return blockPattern.test(base);
        });
        if (hasOverride) {
          found.push({ label: prefix, category, value: prefix });
        }
      }
    }

    return found;
  }, [classes, blockPattern]);

  const handleDelete = useCallback((tag: TagInfo) => {
    onDeletePrefix?.(tag.value, blockPattern);
  }, [onDeletePrefix, blockPattern]);

  if (pills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 pb-3">
      {pills.map(pill => (
        <PrefixTag
          key={pill.label}
          tag={pill}
          stopPropagation
          onDelete={onDeletePrefix ? handleDelete : undefined}
        />
      ))}
    </div>
  );
};

/** Block-to-pattern mapping for override detection */
export const BLOCK_PATTERNS = {
  position: /^(static|fixed|absolute|relative|sticky|top-|right-|bottom-|left-|inset-|z-)/,
  appearance: /^(opacity-|visible|invisible|overflow-|cursor-|pointer-events-|select-)/,
  layout: /^(flex|grid|block|inline|hidden|w-|h-|min-w-|min-h-|max-w-|max-h-|gap-|items-|justify-|self-|grow|shrink|basis-|order-|col-|row-|aspect-)/,
  typography: /^(text-|font-|leading-|tracking-|decoration-|underline|overline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|truncate|whitespace-|break-|indent-)/,
  spacing: /^(p-|px-|py-|pt-|pr-|pb-|pl-|m-|mx-|my-|mt-|mr-|mb-|ml-|-m)/,
  fill: /^(bg-|from-|via-|to-|gradient-)/,
  stroke: /^(border|outline|ring|divide)/,
  effects: /^(shadow|blur|backdrop-blur|grayscale|invert|sepia|brightness-|contrast-|saturate-|drop-shadow|mix-blend-|bg-blend-)/,
  image: /^(object-|aspect-)/,
  link: /^(underline|no-underline|decoration-)/,
} as const;
