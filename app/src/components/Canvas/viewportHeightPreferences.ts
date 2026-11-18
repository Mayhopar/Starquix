import { useSyncExternalStore } from 'react';
import type { Breakpoint } from '@/store/types';

/** The design screen height — the artboard's floor (one full screen even on an
 * empty page) AND what a vh means inside the frame (SET_MODE
 * designViewportHeight → bridge vh-pin). One height per DEVICE, per project:
 * every desktop width shares one height, like resizing a browser window's width.
 */
export type ScreenDevice = 'mobile' | 'tablet' | 'desktop';

export const DEVICE_OF: Record<Breakpoint, ScreenDevice> = {
  base: 'mobile', sm: 'mobile', md: 'tablet', lg: 'desktop', xl: 'desktop', '2xl': 'desktop',
};

export const SCREEN_PRESETS: Record<ScreenDevice, Array<{ height: number; label: string }>> = {
  mobile: [
    { height: 667, label: 'iPhone SE' },
    { height: 844, label: 'iPhone 15' },
    { height: 915, label: 'Android large' },
    { height: 932, label: 'iPhone 15 Pro Max' },
  ],
  tablet: [
    { height: 1024, label: 'iPad mini' },
    { height: 1180, label: 'iPad Air' },
    { height: 1366, label: 'iPad Pro 12.9"' },
  ],
  desktop: [
    { height: 720, label: 'HD laptop' },
    { height: 800, label: 'Laptop 13"' },
    { height: 900, label: 'Laptop 15"' },
    { height: 1080, label: 'Full HD' },
    { height: 1440, label: 'QHD' },
  ],
};

export const DEFAULT_SCREEN_HEIGHT: Record<ScreenDevice, number> = { mobile: 844, tablet: 1024, desktop: 900 };
export const MIN_SCREEN_HEIGHT = 200;
export const MAX_SCREEN_HEIGHT = 4000;

type Saved = Record<string, Partial<Record<ScreenDevice, number>>>;
const STORAGE_KEY = 'sq:screen-h';
const listeners = new Set<() => void>();

// ponytail: re-parsed per read (a tiny JSON); cache it if it ever shows in a profile.
function read(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

const valid = (h: unknown): h is number => typeof h === 'number' && Number.isFinite(h) && h >= MIN_SCREEN_HEIGHT && h <= MAX_SCREEN_HEIGHT;

export function screenHeight(projectId: string | null, device: ScreenDevice): number {
  const saved = projectId ? read()[projectId]?.[device] : undefined;
  return valid(saved) ? saved : DEFAULT_SCREEN_HEIGHT[device];
}

export function setScreenHeight(projectId: string | null, device: ScreenDevice, height: number): void {
  if (!projectId) return;
  const h = Math.round(Math.min(MAX_SCREEN_HEIGHT, Math.max(MIN_SCREEN_HEIGHT, height)));
  const saved = read();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, [projectId]: { ...saved[projectId], [device]: h } })); }
  catch { return; } // storage blocked: keep the current height
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useScreenHeight(projectId: string | null, device: ScreenDevice): number {
  return useSyncExternalStore(subscribe, () => screenHeight(projectId, device));
}
