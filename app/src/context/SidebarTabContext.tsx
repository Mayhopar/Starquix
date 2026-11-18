import { useContext, useState, useMemo, type ReactNode } from 'react';
import { stableContext } from '@/utils/stableContext';

export type SidebarTopTab = 'pages' | 'assets' | 'content';

interface SidebarTabContextValue {
  activeTopTab: SidebarTopTab;
  setActiveTopTab: (tab: SidebarTopTab) => void;
}

const SidebarTabContext = stableContext<SidebarTabContextValue | null>('SidebarTabContext', null);

export function SidebarTabProvider({ children }: { children: ReactNode }) {
  const [activeTopTab, setActiveTopTab] = useState<SidebarTopTab>('pages');

  const value = useMemo(
    () => ({ activeTopTab, setActiveTopTab }),
    [activeTopTab],
  );

  return (
    <SidebarTabContext.Provider value={value}>
      {children}
    </SidebarTabContext.Provider>
  );
}

export function useSidebarTab() {
  const ctx = useContext(SidebarTabContext);
  if (!ctx) throw new Error('useSidebarTab must be used within SidebarTabProvider');
  return ctx;
}
