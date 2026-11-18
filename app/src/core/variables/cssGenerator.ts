// app/src/core/variables/cssGenerator.ts

import type { VariableCollection, DesignVariable, VariableValue } from './types';

function formatValue(val: VariableValue): string {
  switch (val.type) {
    case 'color': {
      if (val.opacity < 100) {
        // Convert opacity % to 2-digit hex alpha
        const alpha = Math.round((val.opacity / 100) * 255).toString(16).padStart(2, '0');
        return `${val.hex}${alpha}`;
      }
      return val.hex;
    }
    case 'number':
      return `${val.value}${val.unit}`;
    case 'string':
      return val.value;
  }
}

export function generateCSS(collection: VariableCollection): string {
  const defaultMode = collection.modes.find(m => m.isDefault);
  const otherModes = collection.modes.filter(m => !m.isDefault);

  const lines: string[] = [];

  // Group variables by type for comments
  const typeGroups: { label: string; vars: DesignVariable[] }[] = [
    { label: 'Colors', vars: collection.variables.filter(v => v.type === 'color') },
    { label: 'Numbers', vars: collection.variables.filter(v => v.type === 'number') },
    { label: 'Strings', vars: collection.variables.filter(v => v.type === 'string') },
  ];

  function writeVarsForMode(modeId: string, variables: DesignVariable[], indent: string): void {
    for (const v of variables) {
      if (v.values[modeId]) {
        lines.push(`${indent}--${v.name}: ${formatValue(v.values[modeId])};`);
      }
    }
  }

  // :root block (default mode)
  if (defaultMode) {
    lines.push(':root {');
    let hasPrevGroup = false;
    for (const { label, vars } of typeGroups) {
      if (vars.length === 0) continue;
      if (hasPrevGroup) lines.push('');
      lines.push(`  /* ${label} */`);
      writeVarsForMode(defaultMode.id, vars, '  ');
      hasPrevGroup = true;
    }
    lines.push('}');
  }

  // Other mode blocks
  for (const mode of otherModes) {
    lines.push('');
    lines.push(`[data-mode="${mode.name.toLowerCase()}"] {`);
    writeVarsForMode(mode.id, collection.variables, '  ');
    lines.push('}');
  }

  return lines.join('\n') + '\n';
}

/**
 * CSS for a set of collections, joined the same way the live preview
 * injects it (useVariablesSync) and the export emits it (generateAstro).
 * Single source of truth — do not re-implement this join elsewhere.
 */
export function generateCollectionsCSS(collections: VariableCollection[]): string {
  return SQ_BASE_CSS + collections.map(c => generateCSS(c)).join('\n');
}

/**
 * STARQUIX LAYOUT LAW (owner ruling 2026-09-11): margins never collapse — a
 * child's margin stays INSIDE its parent, like Figma. "I see values zeros
 * everywhere, at the same time I see a huge margin" — plain CSS lets a first
 * child's top margin collapse through every padding-less ancestor, so the
 * parent's box moved while its own numbers read 0. A block formatting context
 * on every block container keeps each margin where it was written.
 *
 * Ships INSIDE the managed stylesheet every project imports, so the editor,
 * the preview and the exported site render identically — never an editor-only
 * trick. Every open dispatches a collection (the seed or Editor's default one),
 * so useVariablesSync's observer rewrites the file with this prefix on the next
 * open of any project written before the rule existed — no migration code. `:where()` has zero specificity: any utility (`flex`, `md:grid`,
 * `hidden`, `inline-block`, `contents`) still wins; only the UA default
 * `block` of these containers becomes `flow-root`. `li`, `summary`, tables and
 * inline elements are deliberately absent (their UA display is not `block`).
 */
export const SQ_BASE_CSS =
  '/* sq-base: margins never collapse (Starquix layout law) */\n' +
  ':where(body, main, section, article, aside, header, footer, nav, div, form, figure, blockquote, fieldset, details) { display: flow-root; }\n';
