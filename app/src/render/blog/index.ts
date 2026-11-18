/**
 * Canonical blog renderer.
 *
 * Pure functions from (doc, slotKey) → Astro source. The export pipeline
 * (src/export/blog/collectBlogArtifacts.ts), the dev-server vite-plugin,
 * and the editor preview iframe all consume these.
 *
 * Shape of the boundary:
 *
 *   renderBlogSlotSource({ slotElement, slotElementId, collectionName,
 *                          cardComponentName, settings })
 *       → Astro source for the slot markup (embedded in a home/landing page).
 *
 *   renderBlogCardComponent({ cardElement, collectionName, fields,
 *                             bindings })
 *       → Astro source for the card component file
 *         (src/components/sq-templates/{coll}-card.astro).
 *
 *   renderContentConfig(doc) → `src/content.config.ts` source, or null
 *         if the doc has no content collections.
 *
 * **Rule:** never write blog Astro source outside this module. Future
 * "render in preview" pipelines go here too — add new functions, do not
 * bypass with inline string templating.
 */

export {
  generateBlogSlotMarkup as renderBlogSlotSource,
  type GenerateBlogSlotMarkupArgs as RenderBlogSlotSourceArgs,
} from './generateBlogSlotMarkup';

export {
  generateCardComponent as renderBlogCardComponent,
} from './generateCardComponent';

export {
  generateContentConfigFromDoc as renderContentConfig,
} from './generateContentConfigFromDoc';
