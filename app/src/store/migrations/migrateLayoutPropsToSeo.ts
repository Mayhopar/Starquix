import * as Y from 'yjs';
import { LAYOUT_SEO_RESERVED_PROPS } from '../layoutReservedProps';

/**
 * One-time, idempotent migration: hand-typed reserved layout props
 * (title/description) move from page.layoutProps into page.seo (the single
 * source of truth), unless seo already has a non-empty value for that field.
 * The reserved keys are then stripped from layoutProps. Idempotent because no
 * reserved key remains in layoutProps after the first run.
 */
export function migrateLayoutPropsToSeo(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  doc.transact(() => {
    pages.forEach((value) => {
      const page = value as Y.Map<unknown>;
      const layoutProps = page.get('layoutProps') as Record<string, string> | undefined;
      if (!layoutProps) return;

      // Single pass: partition into reserved keys (move to seo) and the rest.
      const reserved: string[] = [];
      const remaining: Record<string, string> = {};
      for (const [k, v] of Object.entries(layoutProps)) {
        if (LAYOUT_SEO_RESERVED_PROPS.has(k)) reserved.push(k);
        else remaining[k] = v;
      }
      if (reserved.length === 0) return;

      let seoMap = page.get('seo') as Y.Map<unknown> | undefined;
      if (!seoMap) { seoMap = new Y.Map(); page.set('seo', seoMap); }

      for (const k of reserved) {
        const existing = seoMap.get(k);
        if (existing === undefined || existing === null || existing === '') {
          seoMap.set(k, layoutProps[k]);
        }
      }

      if (Object.keys(remaining).length > 0) page.set('layoutProps', remaining);
      else page.delete('layoutProps');
    });
  }, 'migration');
}
