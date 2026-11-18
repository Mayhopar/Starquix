import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    const stored = localStorage.getItem('starquix-theme') as Theme;
    return stored || 'system';
  });

  // Track system preference in state so components re-render when it changes
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && systemDark.matches);
      root.classList.toggle('dark', isDark);
      // Update state when system preference changes
      setSystemPrefersDark(systemDark.matches);
    };

    apply();
    localStorage.setItem('starquix-theme', theme);

    // Always listen for system preference changes, not just when theme === 'system'
    // This ensures systemPrefersDark state stays in sync
    systemDark.addEventListener('change', apply);
    return () => systemDark.removeEventListener('change', apply);
  }, [theme]);

  // Compute isDark from state (not directly from matchMedia) so it updates reactively
  const isDark = theme === 'dark' || (theme === 'system' && systemPrefersDark);

  return { theme, setTheme, isDark };
}
