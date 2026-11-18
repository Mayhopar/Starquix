import { prepareFrontmatterPatch } from './frontmatterPatch';

/** Presentation capability from the source already read for this post.
 * Reuse the writer's proof without applying or dispatching its candidate patch.
 * The writer still rechecks fresh source before every real edit. */
export function readOnlyFrontmatterKeys(raw: string, values: Readonly<Record<string, unknown>>): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    let candidate: unknown;
    if (typeof value === 'string') candidate = `${value}\n`;
    else if (typeof value === 'boolean') candidate = !value;
    else if (Array.isArray(value) && value.every(item => typeof item === 'string')) candidate = [...value, ''];
    else continue; // Other value types already have read-only property controls.
    try { prepareFrontmatterPatch(raw, { [key]: candidate }); }
    catch { keys.push(key); }
  }
  return keys;
}
