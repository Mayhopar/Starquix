import { describe, expect, it } from 'vitest';
import { parsePostBody, type PostDoc } from '../postModel';
import { hasPendingPostWrites, PostWriteQueue } from '../writeQueue';

// The native acceptance post is Markdown: its HTML comment is legal source,
// alongside opaque HTML, table, and code blocks that must retain their bytes.
const body = `An editable paragraph with **bold** and *italic* text.

## Typed article heading

- First item
- Second item

<aside data-preserve="opaque-html">Keep this raw HTML unchanged.</aside>

<!-- Keep this Markdown comment byte-for-byte. -->

| Key | Value |
| --- | --- |
| preserved | table |

\`\`\`js
const opaqueFence = "keep this source";
\`\`\`
`;

describe('post queue source format', () => {
  it.each(['frontmatter', 'body'] as const)('saves the first Markdown %s edit and preserves opaque bytes', async edit => {
    const projectId = `markdown-${edit}`;
    const baseline = { frontmatter: { code: '0012' }, body };
    let saved = baseline;
    const queue = new PostWriteQueue({
      projectId, collection: 'typed', slug: 'typed-properties', format: 'md', baseline,
      writePost: async (_collection, _slug, frontmatter, nextBody) => {
        saved = { frontmatter: frontmatter as typeof baseline.frontmatter, body: nextBody };
      },
    });
    const doc = parsePostBody(body, 'md');
    if (edit === 'body') {
      const paragraph = doc.blocks[0];
      if (paragraph.kind !== 'paragraph' || paragraph.mdast.type !== 'paragraph') throw new Error('Fixture starts with a paragraph');
      const text = paragraph.mdast.children[0];
      if (text.type !== 'text') throw new Error('Paragraph starts with text');
      text.value = text.value.replace('An editable', 'An edited');
      paragraph.dirty = true;
    }
    try {
      await queue.enqueue(doc, { code: edit === 'frontmatter' ? 'false' : '0012' });
      expect(saved).toEqual({
        frontmatter: { code: edit === 'frontmatter' ? 'false' : '0012' },
        body: edit === 'body' ? body.replace('An editable', 'An edited') : body,
      });
      expect(hasPendingPostWrites(projectId)).toBe(false);
    } finally { queue.dispose(); }
  });

  it('still refuses invalid MDX without writing or releasing its pending draft', async () => {
    const projectId = 'invalid-mdx-format';
    let writes = 0;
    const queue = new PostWriteQueue({ projectId, collection: 'posts', slug: 'invalid', format: 'mdx',
      writePost: async () => { writes++; },
    });
    const doc: PostDoc = { blocks: [{ kind: 'passthrough', source: '<Broken prop={', gapBefore: '', nodeType: 'mdxJsxFlowElement' }], eol: '\n', trailing: '' };
    try {
      await expect(queue.enqueue(doc, { title: 'Kept' })).rejects.toThrow();
      await expect(queue.flushNow()).rejects.toThrow();
      expect(writes).toBe(0);
      expect(hasPendingPostWrites(projectId)).toBe(true);
    } finally { queue.dispose(); }
  });

  it('retains a Markdown draft when its actual write fails', async () => {
    const projectId = 'markdown-write-failure';
    const queue = new PostWriteQueue({ projectId, collection: 'typed', slug: 'typed-properties', format: 'md',
      writePost: async () => { throw new Error('Disk unavailable'); },
    });
    try {
      await expect(queue.enqueue(parsePostBody(body, 'md'), { code: 'false' })).rejects.toThrow('Disk unavailable');
      expect(hasPendingPostWrites(projectId)).toBe(true);
    } finally { queue.dispose(); }
  });
});
