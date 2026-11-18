import { defineCollection } from 'astro:content';

// Schema-less on purpose: the fixture's frontmatter is the owner's real shape
// (dates, relative image paths, an empty `lead:`), and a schema would only add
// a second thing to keep in sync.
export const collections = {
  works: defineCollection({ type: 'content' }),
};
