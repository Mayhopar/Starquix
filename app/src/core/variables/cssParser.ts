// app/src/core/variables/cssParser.ts

import type { VariableCollection, VariableMode, DesignVariable, VariableValue } from './types';

interface ParsedBlock {
  selector: string;
  variables: { name: string; value: string }[];
}

function parseBlocks(css: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  // Match selector { ... } blocks
  const blockRegex = /([^{]+)\{([^}]*)\}/g;
  let match;

  while ((match = blockRegex.exec(css)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    const variables: { name: string; value: string }[] = [];

    // Match --name: value; lines
    const varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
    let varMatch;
    while ((varMatch = varRegex.exec(body)) !== null) {
      variables.push({ name: varMatch[1].trim(), value: varMatch[2].trim() });
    }

    if (variables.length > 0) {
      blocks.push({ selector, variables });
    }
  }

  return blocks;
}

function inferType(value: string): VariableValue['type'] {
  // Color: hex, rgb, hsl
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return 'color';
  if (/^(rgb|hsl)a?\(/.test(value)) return 'color';
  // Number: digits with optional unit
  if (/^-?\d+(\.\d+)?(px|rem|em|%|vh|vw|ch|ex|cap|lh|vmin|vmax|svh|svw|dvh|dvw)?$/.test(value)) return 'number';
  return 'string';
}

function parseValue(raw: string): VariableValue {
  const type = inferType(raw);

  if (type === 'color') {
    // Handle 8-digit hex (with alpha)
    if (/^#[0-9a-fA-F]{8}$/.test(raw)) {
      const hex = raw.slice(0, 7);
      const alpha = parseInt(raw.slice(7, 9), 16);
      const opacity = Math.round((alpha / 255) * 100);
      return { type: 'color', hex, opacity };
    }
    return { type: 'color', hex: raw, opacity: 100 };
  }

  if (type === 'number') {
    const numMatch = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
    if (numMatch) {
      return { type: 'number', value: parseFloat(numMatch[1]), unit: numMatch[2] || '' };
    }
    return { type: 'number', value: 0, unit: '' };
  }

  return { type: 'string', value: raw };
}

/**
 * Resolve block selector to a mode name.
 * :root maps to the existing default mode name; [data-mode="x"] maps to "x".
 * Returns null for unrecognized selectors.
 */
function resolveModeInfo(
  selector: string,
  defaultModeName: string
): { name: string; isDefault: boolean } | null {
  if (selector === ':root') {
    return { name: defaultModeName, isDefault: true };
  }
  const match = selector.match(/\[data-mode="([^"]+)"\]/);
  if (!match) return null;
  return { name: match[1], isDefault: false };
}

/**
 * Parse CSS into a VariableCollection, preserving the existing collection's
 * IDs where possible (matching by mode name and variable name).
 */
export function parseCSS(css: string, existing: VariableCollection): VariableCollection {
  const blocks = parseBlocks(css);
  const defaultModeName = existing.modes.find(m => m.isDefault)?.name || 'Light';

  // Build mode mapping: selector → mode name
  // :root → default mode
  // [data-mode="dark"] → "dark"
  const modeMap = new Map<string, string>(); // modeName (lowercase) → modeId
  const newModes: VariableMode[] = [];

  // Preserve existing modes where names match
  const existingModeByName = new Map(existing.modes.map(m => [m.name.toLowerCase(), m]));

  for (const block of blocks) {
    const modeInfo = resolveModeInfo(block.selector, defaultModeName);
    if (!modeInfo) continue;

    const key = modeInfo.name.toLowerCase();
    if (modeMap.has(key)) continue;

    const existingMode = existingModeByName.get(key);
    const modeId = existingMode?.id || crypto.randomUUID();

    modeMap.set(key, modeId);
    newModes.push({
      id: modeId,
      name: existingMode?.name || modeInfo.name[0].toUpperCase() + modeInfo.name.slice(1),
      isDefault: modeInfo.isDefault,
    });
  }

  // Build variable map: name → { id, type, values: { modeId: value } }
  const existingVarByName = new Map(existing.variables.map(v => [v.name, v]));
  const variableMap = new Map<string, DesignVariable>();

  for (const block of blocks) {
    const modeInfo = resolveModeInfo(block.selector, defaultModeName);
    if (!modeInfo) continue;

    const modeId = modeMap.get(modeInfo.name.toLowerCase());
    if (!modeId) continue;

    for (const { name, value } of block.variables) {
      let variable = variableMap.get(name);
      if (!variable) {
        const existingVar = existingVarByName.get(name);
        variable = {
          id: existingVar?.id || crypto.randomUUID(),
          name,
          type: existingVar?.type || inferType(value),
          values: {},
        };
        variableMap.set(name, variable);
      }
      variable.values[modeId] = parseValue(value);
    }
  }

  return {
    id: existing.id,
    name: existing.name,
    modes: newModes.length > 0 ? newModes : existing.modes,
    variables: [...variableMap.values()],
  };
}
