/**
 * Theme Context
 *
 * Manages the active editing theme (light, dark) for the DesignBar.
 * When dark theme is selected, the DesignBar filters classes to show
 * dark theme values and adds the dark: prefix when saving changes.
 */

import React, {
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react';
import type { Theme } from '@/core/classes/index';
import { stableContext } from '@/utils/stableContext';

// ============================================================================
// Types
// ============================================================================

export const PRIMARY_THEME: Theme = 'light';

export interface ThemeContextValue {
  /** Currently active theme for editing */
  activeTheme: Theme;
  /** Set the active editing theme */
  setActiveTheme: (theme: Theme) => void;
  /** Whether we're editing dark theme */
  isEditingDark: boolean;
  /** Reset to light theme */
  resetToLight: () => void;
  /** Get prefix for current theme (empty for light) */
  getPrefix: () => string;
}

const ThemeContext = stableContext<ThemeContextValue | null>('ThemeContext', null);

// ============================================================================
// Provider
// ============================================================================

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Callback when active theme changes */
  onThemeChange?: (theme: Theme) => void;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  onThemeChange
}) => {
  const [activeTheme, setActiveThemeInternal] = useState<Theme>(PRIMARY_THEME);

  const setActiveTheme = useCallback((theme: Theme) => {
    setActiveThemeInternal(theme);
    onThemeChange?.(theme);
  }, [onThemeChange]);

  const resetToLight = useCallback(() => {
    setActiveThemeInternal(PRIMARY_THEME);
    onThemeChange?.(PRIMARY_THEME);
  }, [onThemeChange]);

  const getPrefix = useCallback(() => {
    return activeTheme === PRIMARY_THEME ? '' : `${activeTheme}:`;
  }, [activeTheme]);

  const value = useMemo<ThemeContextValue>(() => ({
    activeTheme,
    setActiveTheme,
    isEditingDark: activeTheme === 'dark',
    resetToLight,
    getPrefix
  }), [activeTheme, setActiveTheme, resetToLight, getPrefix]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

// ============================================================================
// Hook
// ============================================================================

export const useActiveTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useActiveTheme must be used within a ThemeProvider');
  }
  return context;
};

export default ThemeContext;
