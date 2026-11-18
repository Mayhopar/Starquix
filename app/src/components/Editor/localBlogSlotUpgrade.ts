/**
 * A project's BlogSlot.astro (materialized by an older build) upgrades itself
 * to the library's layout-proof shape — the same automatic, gesture-less,
 * plain journaled write the card's image box uses (localFieldBind
 * upgradeLocalCardImage; the structural writer refuses non-page files).
 */
import { readLocalFile, writeLocalFile } from '@/utils/localElementSource';
import { upgradeBlogSlotSource } from '@/utils/blogSlotChrome';
import type { BindResult } from './localBlogBind';

export const SLOT_FILE = 'src/components/BlogSlot.astro';

export async function upgradeLocalBlogSlotChrome(): Promise<BindResult> {
  let before: string;
  try { before = await readLocalFile(SLOT_FILE); }
  catch { return { ok: false, reason: 'could not read the slot component file' }; }
  const after = upgradeBlogSlotSource(before);
  if (after === before) return { ok: true };
  try { await writeLocalFile(SLOT_FILE, after); return { ok: true }; }
  catch (err) { return { ok: false, reason: err instanceof Error ? err.message : 'could not write the slot component file' }; }
}
