// app/src/components/VariablesEditor/constants.ts

import type { VariableValue } from '@/core/variables/types';

export type VariableType = 'color' | 'number' | 'string';

export const VARIABLE_TYPES: VariableType[] = ['color', 'number', 'string'];

export const TYPE_ICONS: Record<VariableType, string> = {
  color: '\u25D0',  // ◐
  number: '#',
  string: 'Aa',
};

export const TYPE_LABELS: Record<VariableType, string> = {
  color: 'Color',
  number: 'Number',
  string: 'String',
};

export function defaultValueForType(type: VariableType): VariableValue {
  switch (type) {
    case 'color': return { type: 'color', hex: '#000000', opacity: 100 };
    case 'number': return { type: 'number', value: 0, unit: 'px' };
    case 'string': return { type: 'string', value: '' };
  }
}

// ── Shared class constants ─────────────────────────────────────────────

export const CELL_CLASS = 'border-b border-r border-stroke/40';

export const HEADER_CELL_CLASS = `${CELL_CLASS} px-3 py-1 text-left text-xs font-semibold text-text-muted`;

// ── Helpers ────────────────────────────────────────────────────────────

export function arrowKeyDelta(e: React.KeyboardEvent): number {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return 0;
  const step = e.shiftKey ? 8 : 1;
  return e.key === 'ArrowUp' ? step : -step;
}
