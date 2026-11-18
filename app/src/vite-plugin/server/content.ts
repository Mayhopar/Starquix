/**
 * Content-collection endpoints: discovery + post CRUD + post-page template
 * generation. Moved verbatim from vite-plugin/index.ts configureServer.
 */
import * as path from 'path';
import { writeFile, mkdir, unlink, rm } from 'fs/promises';
import type { SqServerContext } from './context';

export function registerContentEndpoints(ctx: SqServerContext): void {
  const { server, projectRoot, readJsonBody, formatError, queueFileWrite } = ctx;

  server.middlewares.use('/__sq/content-collections', async (req, res, next) => {
    if (req.method !== 'GET') { next(); return; }
    try {
      const { discoverContentCollections } = await import('../content-collection-discovery');
      const collections = await discoverContentCollections(projectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(collections));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  server.middlewares.use('/__sq/create-post', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    try {
      const body = (await readJsonBody(req)) as {
        collection: string; slug: string;
        frontmatter: Record<string, unknown>; body: string;
      };
      const grayMatter = (await import('gray-matter')).default;
      const dir = path.join(projectRoot, 'src', 'content', body.collection);
      await mkdir(dir, { recursive: true });
      const content = grayMatter.stringify(body.body || '', body.frontmatter);
      await writeFile(path.join(dir, `${body.slug}.md`), content, 'utf-8');
      server.ws.send({ type: 'custom', event: 'sq:content-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  server.middlewares.use('/__sq/delete-post', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    try {
      const body = (await readJsonBody(req)) as { collection: string; slug: string };
      const filePath = path.join(projectRoot, 'src', 'content', body.collection, `${body.slug}.md`);
      await unlink(filePath);
      server.ws.send({ type: 'custom', event: 'sq:content-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  server.middlewares.use('/__sq/delete-collection', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    try {
      const body = (await readJsonBody(req)) as { collection: string };
      const collectionDir = path.join(projectRoot, 'src', 'content', body.collection);
      await rm(collectionDir, { recursive: true, force: true });
      server.ws.send({ type: 'custom', event: 'sq:content-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  server.middlewares.use('/__sq/update-post', async (req, res, next) => {
    if (req.method !== 'POST') { next(); return; }
    try {
      const body = (await readJsonBody(req)) as {
        collection: string; slug: string;
        frontmatter: Record<string, unknown>; body: string;
      };
      const grayMatter = (await import('gray-matter')).default;
      const filePath = path.join(projectRoot, 'src', 'content', body.collection, `${body.slug}.md`);
      const content = grayMatter.stringify(body.body || '', body.frontmatter);
      await queueFileWrite(filePath, () => writeFile(filePath, content, 'utf-8'));
      server.ws.send({ type: 'custom', event: 'sq:content-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

}
