import type { Manifest } from './types';

/**
 * task-207 D10: Media's manifest, inlined.
 *
 * The editor bundle cannot read `preview-template/src/components/Media.astro`
 * at runtime, and only LOCAL mode scans the user's own folder — so in WC there
 * is no scan entry for the copy under `sq/` at all. This literal is that
 * runtime's only source (D9: one code path, WC just resolves to the fallback).
 *
 * In local mode `manifestForComponent` prefers the SCANNED frontmatter, so a
 * user who edits their own `sq/Media.astro` gets the knobs their file declares.
 * `__tests__/mediaManifest.test.ts` asserts this literal equals what the real
 * template parses to, so the fallback cannot silently drift from the template.
 */
/** Where `ensure-sq-component` copies our template into the user's project. */
export const MEDIA_COMPONENT_PATH = 'src/components/sq/Media.astro';

export const MEDIA_MANIFEST: Manifest = {
  props: [
    { name: 'items', label: 'Items', control: { kind: 'slots' } },
    { name: 'gap', label: 'Gap', control: { kind: 'number', unit: 'px' } },
    { name: 'pad', label: 'Padding', control: { kind: 'number', unit: 'px' } },
    { name: 'margin', label: 'Margin', control: { kind: 'number', unit: 'px' } },
    { name: 'radius', label: 'Radius', control: { kind: 'number', unit: 'px' } },
  ],
};
