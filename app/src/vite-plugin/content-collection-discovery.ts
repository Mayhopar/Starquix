import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import matter from 'gray-matter';

export interface DiscoveredPost {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
  filePath: string;
}

export interface DiscoveredCollection {
  name: string;
  posts: DiscoveredPost[];
  inferredFields: Array<{ name: string; type: string }>;
}

export async function discoverContentCollections(projectRoot: string): Promise<DiscoveredCollection[]> {
  const contentDir = join(projectRoot, 'src', 'content');

  try {
    await stat(contentDir);
  } catch {
    return [];
  }

  const entries = await readdir(contentDir, { withFileTypes: true });
  const collections: DiscoveredCollection[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'config.ts') continue;

    const collectionDir = join(contentDir, entry.name);
    const posts = await discoverPosts(collectionDir, projectRoot);
    const inferredFields = inferFieldsFromPosts(posts);

    collections.push({
      name: entry.name,
      posts,
      inferredFields,
    });
  }

  return collections;
}

async function discoverPosts(dir: string, projectRoot: string): Promise<DiscoveredPost[]> {
  const files = await readdir(dir);
  const posts: DiscoveredPost[] = [];

  for (const file of files) {
    if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;

    const filePath = join(dir, file);
    const content = await readFile(filePath, 'utf-8');
    const { data: frontmatter, content: body } = matter(content);

    posts.push({
      slug: basename(file, file.endsWith('.mdx') ? '.mdx' : '.md'),
      frontmatter,
      body,
      filePath: relative(projectRoot, filePath),
    });
  }

  posts.sort((a, b) => {
    const dateA = a.frontmatter.date ? new Date(a.frontmatter.date as string).getTime() : 0;
    const dateB = b.frontmatter.date ? new Date(b.frontmatter.date as string).getTime() : 0;
    return dateB - dateA;
  });

  return posts;
}

function inferFieldsFromPosts(posts: DiscoveredPost[]): Array<{ name: string; type: string }> {
  const fieldMap = new Map<string, Set<string>>();

  for (const post of posts) {
    for (const [key, value] of Object.entries(post.frontmatter)) {
      if (!fieldMap.has(key)) fieldMap.set(key, new Set());
      const types = fieldMap.get(key)!;

      if (value instanceof Date) types.add('date');
      else if (typeof value === 'boolean') types.add('boolean');
      else if (typeof value === 'string') {
        if (/\.(jpg|jpeg|png|gif|svg|webp)$/i.test(value) || value.startsWith('/images/')) {
          types.add('image');
        } else if (/^https?:\/\//.test(value)) {
          types.add('url');
        } else {
          types.add('text');
        }
      }
      else if (Array.isArray(value)) types.add('list');
      else types.add('text');
    }
  }

  return Array.from(fieldMap.entries()).map(([name, types]) => ({
    name,
    type: types.size === 1 ? types.values().next().value! : 'text',
  }));
}
