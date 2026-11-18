import { MoonIcon as SharedMoonIcon, SunIcon as SharedSunIcon } from '@/assets/icons';
import { useTheme } from '@/hooks';
import { Button } from '@/components/ui';

export function ThemeToggle() {
  const { isDark, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      iconOnly
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <SharedSunIcon width="16" height="16" />
      ) : (
        <SharedMoonIcon width="16" height="16" />
      )}
    </Button>
  );
}
