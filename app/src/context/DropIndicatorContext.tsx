// app/src/context/DropIndicatorContext.tsx
import { useContext, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { stableContext } from '@/utils/stableContext';

interface DropIndicatorState {
  isVisible: boolean;
  top: number;
  position: 'above' | 'below';
  targetIndex: number;
}

const INITIAL_STATE: DropIndicatorState = {
  isVisible: false,
  top: 0,
  position: 'below',
  targetIndex: -1,
};

interface DropIndicatorContextValue {
  dropIndicator: DropIndicatorState;
  showDropIndicator: (top: number, position: 'above' | 'below', targetIndex: number) => void;
  hideDropIndicator: () => DropIndicatorState;
}

const DropIndicatorContext = stableContext<DropIndicatorContextValue | null>('DropIndicatorContext', null);

export function DropIndicatorProvider({ children }: { children: ReactNode }) {
  const [dropIndicator, setDropIndicator] = useState<DropIndicatorState>(INITIAL_STATE);

  // Ref tracks latest state for safe reading in hideDropIndicator
  const dropIndicatorRef = useRef<DropIndicatorState>(INITIAL_STATE);

  const showDropIndicator = useCallback((top: number, position: 'above' | 'below', targetIndex: number) => {
    const newState = { isVisible: true, top, position, targetIndex };
    dropIndicatorRef.current = newState;
    setDropIndicator(newState);
  }, []);

  const hideDropIndicator = useCallback((): DropIndicatorState => {
    const lastState = dropIndicatorRef.current;
    dropIndicatorRef.current = INITIAL_STATE;
    setDropIndicator(INITIAL_STATE);
    return lastState;
  }, []);

  const value = useMemo(
    () => ({ dropIndicator, showDropIndicator, hideDropIndicator }),
    [dropIndicator, showDropIndicator, hideDropIndicator]
  );

  return (
    <DropIndicatorContext.Provider value={value}>
      {children}
    </DropIndicatorContext.Provider>
  );
}

export function useDropIndicator(): DropIndicatorContextValue {
  const context = useContext(DropIndicatorContext);
  if (!context) {
    throw new Error('useDropIndicator must be used within a DropIndicatorProvider');
  }
  return context;
}
