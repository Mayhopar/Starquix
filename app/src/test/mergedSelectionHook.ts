// Test-only merged selection hook. The production useSelection() export was
// retired (task-075 phase E — targeted subscriptions only); tests that drive
// both contexts together use this instead.
import { useSelectionContext, useScannedElements } from '@/context/SelectionContext';

export const useSelection = () => ({ ...useSelectionContext(), ...useScannedElements() });
