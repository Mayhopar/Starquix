// app/src/core/variables/types.ts

export interface VariableMode {
  id: string;
  name: string;
  isDefault: boolean;
}

export type VariableValue =
  | { type: 'color'; hex: string; opacity: number }
  | { type: 'number'; value: number; unit: string }
  | { type: 'string'; value: string };

export interface DesignVariable {
  id: string;
  name: string;                              // stored WITHOUT "--" prefix
  type: 'color' | 'number' | 'string';
  values: Record<string, VariableValue>;     // keyed by mode ID
}

export interface VariableCollection {
  id: string;
  name: string;
  modes: VariableMode[];
  variables: DesignVariable[];
}

/** Default empty collection for new projects */
export function createDefaultCollection(): VariableCollection {
  const lightId = crypto.randomUUID();
  const darkId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    name: 'Variables',
    modes: [
      { id: lightId, name: 'Light', isDefault: true },
      { id: darkId, name: 'Dark', isDefault: false },
    ],
    variables: [],
  };
}
