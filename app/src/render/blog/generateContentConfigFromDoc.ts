import * as Y from 'yjs';
import { selectContentCollections } from '@/store/collectionSelectors';
import { generateContentConfig } from '@/vite-plugin/content-config-generator';

/**
 * Derive `src/content.config.ts` source from the Yjs doc. Returns null when the
 * doc has no content collections (caller omits the file).
 */
export function generateContentConfigFromDoc(doc: Y.Doc): string | null {
  const collections = selectContentCollections(doc);
  if (collections.length === 0) return null;
  return generateContentConfig(collections);
}
