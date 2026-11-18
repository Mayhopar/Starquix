import type { ContentCollection, FieldType } from '../core/collections/types';

function fieldTypeToZod(type: FieldType, required: boolean): string {
  const base = (() => {
    switch (type) {
      case 'text': return 'z.string()';
      // coerce: frontmatter dates arrive as strings when quoted ("2026-01-15")
      // — plain z.date() fails the build on Astro's content sync.
      case 'date': return 'z.coerce.date()';
      case 'image': return 'z.string()';
      case 'url': return 'z.string().url()';
      case 'boolean': return 'z.boolean()';
      case 'list': return 'z.array(z.string())';
      default: return 'z.string()';
    }
  })();
  return required ? base : `${base}.optional()`;
}

/** Collection/field names are user input ("Blog collection") — not valid JS
 *  identifiers. Vars get sanitized; map/object keys stay raw but quoted so
 *  getCollection('<raw name>') and frontmatter keys keep matching. */
export function toIdentifier(name: string): string {
  const id = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

export function generateContentConfig(collections: ContentCollection[]): string {
  if (collections.length === 0) return '';

  const collectionDefs = collections.map(col => {
    const fieldLines = col.fields
      .map(f => `    ${JSON.stringify(f.name)}: ${fieldTypeToZod(f.type, f.required)},`)
      .join('\n');

    // Astro 5: use the modern `loader: glob(...)` API. The legacy `type: 'content'`
    // path is deprecated and can silently return [] on some builds.
    return `const ${toIdentifier(col.name)} = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: ${JSON.stringify(`./src/content/${col.name}`)} }),
  schema: z.object({
${fieldLines}
  }),
});`;
  }).join('\n\n');

  const exportNames = collections
    .map(c => `${JSON.stringify(c.name)}: ${toIdentifier(c.name)}`)
    .join(', ');

  return `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

${collectionDefs}

export const collections = { ${exportNames} };
`;
}
