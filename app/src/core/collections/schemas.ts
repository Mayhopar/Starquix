import { z } from 'zod';
import { DEFAULT_BLOG_SETTINGS } from './types';
import { reportExportEvent } from '@/services/exportTelemetry';

/**
 * Zod schemas for blog Yjs shapes. Every boundary read goes through
 * `.parse()` (dev — throws loud) or `.safeParse()` (prod — falls back +
 * reports drift). Casting Y.Map<unknown> to a typed interface silently
 * succeeds on shape drift; parsing does not.
 *
 * Why enums vs z.string(): the three pagination modes, four sort modes,
 * and two layout modes are load-bearing for export correctness. A typo
 * in Yjs ('numberd' instead of 'numbered') must be a parse error, not a
 * silently-wrong dispatch in template-generator.ts.
 */

export const SortBySchema = z.enum(['date-desc', 'date-asc', 'title-asc', 'title-desc']);
export const PaginationSchema = z.enum(['none', 'numbered', 'load-more']);
export const LayoutSchema = z.enum(['grid', 'list']);

/**
 * NOTE (task-102): every field below carries `.default(...)`, so a parse of a
 * SPARSE settings map yields app defaults for missing fields — a
 * "resolved-ish legacy view" that is NOT master-aware. Consumers that need
 * the real effective settings must use `resolveBlogSettings` (yjsAccessors);
 * sparse truth comes only from `readBlogSettingsRaw`.
 */
export const BlogSlotSettingsSchema = z.object({
  postsPerPage: z.number().int().positive().default(DEFAULT_BLOG_SETTINGS.postsPerPage),
  sortBy: SortBySchema.default(DEFAULT_BLOG_SETTINGS.sortBy),
  pagination: PaginationSchema.default(DEFAULT_BLOG_SETTINGS.pagination),
  layout: LayoutSchema.default(DEFAULT_BLOG_SETTINGS.layout),
  columns: z.number().int().positive().default(DEFAULT_BLOG_SETTINGS.columns),
  gap: z.string().default(DEFAULT_BLOG_SETTINGS.gap),
  // postLinkMode is 'auto' | 'none' | <field-name>; keep it permissive as
  // a string but normalize missing → default.
  postLinkMode: z.string().default(DEFAULT_BLOG_SETTINGS.postLinkMode ?? 'auto'),
});

export const BlogSlotBindingSchema = z.object({
  collectionId: z.string().min(1),
  settings: BlogSlotSettingsSchema,
  bindings: z.record(z.string(), z.string()).default({}),
  // task-102 sparse-inheritance revs (master counter / instance baseline).
  settingsRev: z.number().int().nonnegative().optional(),
  settingsBaseRev: z.number().int().nonnegative().optional(),
});

export type BlogSlotSettingsParsed = z.infer<typeof BlogSlotSettingsSchema>;
export type BlogSlotBindingParsed = z.infer<typeof BlogSlotBindingSchema>;

/**
 * Convert a raw Y.Map blog-slot binding into a plain JS object suitable
 * for Zod parsing. Walks the Y.Map children to extract the two nested
 * Y.Maps (`settings`, `bindings`).
 */
export function ySlotToPlain(ySlot: unknown): unknown {
  if (!ySlot || typeof ySlot !== 'object') return ySlot;
  const slot = ySlot as { get?: (k: string) => unknown; forEach?: (fn: (v: unknown, k: string) => void) => void };
  if (typeof slot.get !== 'function') return ySlot;

  const ySettings = slot.get('settings');
  const yBindings = slot.get('bindings');

  const settings: Record<string, unknown> = {};
  if (ySettings && typeof (ySettings as { forEach?: unknown }).forEach === 'function') {
    (ySettings as { forEach: (fn: (v: unknown, k: string) => void) => void }).forEach((v, k) => {
      settings[k] = v;
    });
  }

  const bindings: Record<string, string> = {};
  if (yBindings && typeof (yBindings as { forEach?: unknown }).forEach === 'function') {
    (yBindings as { forEach: (fn: (v: unknown, k: string) => void) => void }).forEach((v, k) => {
      if (typeof v === 'string') bindings[k] = v;
    });
  }

  return {
    collectionId: slot.get('collectionId'),
    settings,
    bindings,
    // task-102: carry the revs through (JSON-undefined when absent).
    settingsRev: slot.get('settingsRev'),
    settingsBaseRev: slot.get('settingsBaseRev'),
  };
}

/**
 * Telemetry hook. Loud in dev, warn in prod. Also emits a
 * `shape.drift` export-telemetry event so metrics pick it up without
 * parsing console logs.
 */
export function reportShapeDrift(location: string, error: unknown): void {
  const message = `[starquix] Yjs shape drift at ${location}`;
  if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    console.error(message, error);
  } else {
    console.warn(message, error);
  }
  reportExportEvent('shape.drift', {
    location,
    message: error instanceof Error ? error.message : String(error),
  });
}
