import type * as Y from 'yjs';
import { applyAllOverrides } from '@/store/selectors';
import { baseMarkup } from '@/store/masters';

export interface GenerateCardComponentArgs {
  collectionName: string;
  bindings: Record<string, string>;
  cardElement: Y.Map<unknown>;
  doc: Y.Doc;
}

/**
 * Produce the source of `src/components/sq-templates/{collection}-card.astro`.
 * Takes the `:blogcard` drawn element (or instance-model card child), applies
 * its override stack on top of the baseMarkup-resolved base (masters overlay
 * wins — task-082), and rewrites `{field}` placeholders into
 * `{post.data.field}` references.
 */
export function generateCardComponent({
  collectionName,
  bindings,
  cardElement,
  doc,
}: GenerateCardComponentArgs): string {
  const raw = baseMarkup(doc, cardElement);

  const markup = raw
    ? applyAllOverrides(raw, cardElement)
    : `<article data-empty-card="${collectionName}">{post.data.title ?? 'Untitled'}</article>`;

  let substituted = markup;
  for (const fieldName of Object.values(bindings)) {
    substituted = substituted.replace(
      new RegExp(`\\{${fieldName}\\}`, 'g'),
      `{post.data.${fieldName}}`,
    );
  }

  return `---
const { post } = Astro.props;
---
${substituted}
`;
}
