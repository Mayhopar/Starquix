// Schema follows the field (2026-09-12): a field added / removed on a
// files-truth collection is declared / undeclared in that collection's
// `z.object({…})` in the user's content config — a SURGICAL line edit, never
// a rewrite. Without it a strict schema strips the key from post.data and the
// site never sees the field. No config, or a collection the config does not
// declare → unchanged.
import { describe, it, expect } from 'vitest';
import { addFieldToContentConfig, removeFieldFromContentConfig, zodFor, isImageSchemaFieldIn, requiredFieldsIn, makeFieldOptionalInContentConfig } from '../contentConfigSchema';

const IMPORTED = `import { defineCollection, z } from "astro:content";

const worksCollection = defineCollection({
    schema: ({ image }) => z.object({
        featured: z.boolean().default(false),
        image: image(),
        title: z.string(),
        link: z.string().optional(),
    })
})

export const collections = {
    works: worksCollection,
};
`;

const SCAFFOLD = `import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  blog,
};
`;

describe('zodFor', () => {
  it('maps every editor field type to an optional zod declaration', () => {
    expect(zodFor('text')).toBe('z.string().optional()');
    expect(zodFor('url')).toBe('z.string().optional()');
    expect(zodFor('image')).toBe('z.string().optional()');
    expect(zodFor('date')).toBe('z.coerce.date().optional()');
    expect(zodFor('boolean')).toBe('z.boolean().optional()');
    expect(zodFor('list')).toBe('z.array(z.string()).optional()');
  });
});

describe('addFieldToContentConfig', () => {
  it('inserts the field as the last property of the named collection (via `name: ident`), matching its indentation', () => {
    const out = addFieldToContentConfig(IMPORTED, 'works', 'coverImage', 'image');
    expect(out).toContain('        link: z.string().optional(),\n        coverImage: z.string().optional(),\n    })');
    expect(out.replace('        coverImage: z.string().optional(),\n', '')).toBe(IMPORTED);
  });

  it('resolves the shorthand `{ blog }` entry and a plain `schema: z.object`', () => {
    const out = addFieldToContentConfig(SCAFFOLD, 'blog', 'published', 'date');
    expect(out).toContain('    draft: z.boolean().default(false),\n    published: z.coerce.date().optional(),\n  }),');
  });

  it('adds the missing trailing comma to the previous last property', () => {
    const cfg = SCAFFOLD.replace('draft: z.boolean().default(false),', 'draft: z.boolean().default(false)');
    const out = addFieldToContentConfig(cfg, 'blog', 'tags', 'list');
    expect(out).toContain('    draft: z.boolean().default(false),\n    tags: z.array(z.string()).optional(),\n  }),');
  });

  it('fills an empty z.object({})', () => {
    const cfg = "import { defineCollection, z } from 'astro:content';\nconst notes = defineCollection({ schema: z.object({}) });\nexport const collections = { notes };\n";
    expect(addFieldToContentConfig(cfg, 'notes', 'title', 'text')).toBe(
      "import { defineCollection, z } from 'astro:content';\nconst notes = defineCollection({ schema: z.object({\n  title: z.string().optional(),\n}) });\nexport const collections = { notes };\n",
    );
  });

  it('is a no-op when the field is already declared, the collection is not in the config, or there is no schema', () => {
    expect(addFieldToContentConfig(IMPORTED, 'works', 'title', 'text')).toBe(IMPORTED);
    expect(addFieldToContentConfig(IMPORTED, 'blog', 'x', 'text')).toBe(IMPORTED);
    const noSchema = "import { defineCollection } from 'astro:content';\nconst blog = defineCollection({ type: 'content' });\nexport const collections = { blog };\n";
    expect(addFieldToContentConfig(noSchema, 'blog', 'x', 'text')).toBe(noSchema);
  });

  it('handles an inline `name: defineCollection({…})` entry', () => {
    const cfg = "import { defineCollection, z } from 'astro:content';\nexport const collections = {\n  blog: defineCollection({ schema: z.object({\n    title: z.string(),\n  }) }),\n};\n";
    expect(addFieldToContentConfig(cfg, 'blog', 'hero', 'image')).toContain('    title: z.string(),\n    hero: z.string().optional(),\n  }) }),');
  });
});

describe('removeFieldFromContentConfig', () => {
  it('removes exactly the field line (imported shape) — inverse of add', () => {
    const added = addFieldToContentConfig(IMPORTED, 'works', 'coverImage', 'image');
    expect(removeFieldFromContentConfig(added, 'works', 'coverImage')).toBe(IMPORTED);
  });

  it('removes a multi-line property with balanced brackets', () => {
    const cfg = SCAFFOLD.replace('    draft: z.boolean().default(false),\n', "    draft: z.boolean().default(false),\n    meta: z.object({\n      a: z.string(),\n    }).optional(),\n");
    expect(removeFieldFromContentConfig(cfg, 'blog', 'meta')).toBe(SCAFFOLD);
  });

  it('does not touch a property that merely shares a prefix, and is a no-op for an unknown field', () => {
    expect(removeFieldFromContentConfig(IMPORTED, 'works', 'link2')).toBe(IMPORTED);
    expect(removeFieldFromContentConfig(IMPORTED, 'works', 'lin')).toBe(IMPORTED);
    expect(removeFieldFromContentConfig(IMPORTED, 'works', 'nope')).toBe(IMPORTED);
  });
});

// The owner's personal-site config verbatim (2026-09-12): `works` declares
// `image: image()` under the `name: ident` collections form; the editor-added
// `blog` collection has no entry at all.
const PERSONAL_SITE = `import { defineCollection, z } from "astro:content";

const worksCollection = defineCollection({
    schema: ({ image }) => z.object({
        featured: z.boolean().default(false),
        image: image(),
        title: z.string(),
        year: z.string(),
        role: z.string(),
        description: z.string().optional(),
        date: z.date(),
        link: z.string().optional(),
        preview1: z.string(),
        preview2: z.string(),
        preview3: z.string(),
    })
}) 

export const collections = {
    works: worksCollection,
};`;

describe('isImageSchemaFieldIn', () => {
  it('is per collection: works.image is image(), blog (undeclared) and works.preview1 (z.string) are not', () => {
    expect(isImageSchemaFieldIn(PERSONAL_SITE, 'works', 'image')).toBe(true);
    expect(isImageSchemaFieldIn(PERSONAL_SITE, 'works', 'preview1')).toBe(false);
    expect(isImageSchemaFieldIn(PERSONAL_SITE, 'blog', 'image')).toBe(false);
    expect(isImageSchemaFieldIn('', 'works', 'image')).toBe(false);
  });
});

describe('requiredFieldsIn / makeFieldOptionalInContentConfig', () => {
  const MIXED = SCAFFOLD.replace('    draft: z.boolean().default(false),\n', `    draft: z.boolean().default(false),
    hero: z.optional(z.string()),
    seo: z.object({ t: z.string().optional() }),
    url: z.string().url().default('https://x.test/(a)'),
    last: z.string() // keep
`);
  it('reads a declaration as required from its outer call chain only (nested and quoted text say nothing)', () => {
    expect(requiredFieldsIn(IMPORTED, 'works')).toEqual(['image', 'title']);
    expect(requiredFieldsIn(MIXED, 'blog')).toEqual(['title', 'seo', 'last']);
    expect(requiredFieldsIn(IMPORTED, 'blog')).toEqual([]);
  });
  it('appends .optional() to exactly that declaration', () => {
    expect(makeFieldOptionalInContentConfig(IMPORTED, 'works', 'image')).toBe(IMPORTED.replace('image: image(),', 'image: image().optional(),'));
    expect(makeFieldOptionalInContentConfig(MIXED, 'blog', 'seo')).toBe(MIXED.replace('seo: z.object({ t: z.string().optional() }),', 'seo: z.object({ t: z.string().optional() }).optional(),'));
  });
  it('lands before a trailing comment, and is a no-op when already optional or undeclared', () => {
    expect(makeFieldOptionalInContentConfig(MIXED, 'blog', 'last')).toBe(MIXED.replace('last: z.string() // keep', 'last: z.string().optional() // keep'));
    for (const name of ['link', 'featured', 'nope']) expect(makeFieldOptionalInContentConfig(IMPORTED, 'works', name)).toBe(IMPORTED);
  });
});
