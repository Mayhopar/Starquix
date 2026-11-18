// app/src/context/VariablesContext.tsx

import { useContext, useState, type ReactNode } from 'react';
import { stableContext } from '@/utils/stableContext';

interface VariablesContextValue {
  activeCollectionId: string | null;
  setActiveCollectionId: (id: string | null) => void;
}

const VariablesContext = stableContext<VariablesContextValue | null>('VariablesContext', null);

export function VariablesProvider({ children }: { children: ReactNode }): ReactNode {
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);

  return (
    <VariablesContext.Provider value={{ activeCollectionId, setActiveCollectionId }}>
      {children}
    </VariablesContext.Provider>
  );
}

export function useVariables(): VariablesContextValue {
  const ctx = useContext(VariablesContext);
  if (!ctx) throw new Error('useVariables must be used within VariablesProvider');
  return ctx;
}
