/**
 * Layout endpoints: scan/save/prop-edit/delete/rename, plus the reference
 * helpers (collectAstroFiles, findLayoutReferences, rewriteLayoutReferences —
 * only used here). Moved verbatim from vite-plugin/index.ts.
 */
import * as path from 'path';
import { readFile, writeFile, mkdir, unlink, rename, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { applyLayoutPropOp } from '../layoutPropEdit';
import type { SqServerContext } from './context';

async function collectAstroFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      out.push(...await collectAstroFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.astro')) {
      out.push(full);
    }
  }
  return out;
}

async function findLayoutReferences(pagesDir: string, layoutName: string): Promise<string[]> {
  const files = await collectAstroFiles(pagesDir);
  const refs: string[] = [];
  const importRe = new RegExp(`from\\s+['"][^'"]*layouts/${layoutName}\\.astro['"]`);
  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      if (importRe.test(content)) {
        refs.push(path.relative(path.join(pagesDir, '..', '..', '..'), file));
      }
    } catch { /* ignore */ }
  }
  return refs;
}

async function rewriteLayoutReferences(pagesDir: string, oldName: string, newName: string): Promise<void> {
  const files = await collectAstroFiles(pagesDir);
  const importRe = new RegExp(`(from\\s+['"][^'"]*layouts/)${oldName}(\\.astro['"])`, 'g');
  const openTagRe = new RegExp(`<${oldName}(\\s|>|/)`, 'g');
  const closeTagRe = new RegExp(`</${oldName}\\s*>`, 'g');
  const identifierImportRe = new RegExp(`(import\\s+)${oldName}(\\s+from\\s+['"][^'"]*layouts/)`, 'g');
  for (const file of files) {
    let content: string;
    try { content = await readFile(file, 'utf-8'); } catch { continue; }
    if (!importRe.test(content)) continue;
    importRe.lastIndex = 0;
    const updated = content
      .replace(identifierImportRe, `$1${newName}$2`)
      .replace(importRe, `$1${newName}$2`)
      .replace(openTagRe, `<${newName}$1`)
      .replace(closeTagRe, `</${newName}>`);
    if (updated !== content) {
      await writeFile(file, updated, 'utf-8');
    }
  }
}

export function registerLayoutsEndpoints(ctx: SqServerContext): void {
  const { server, projectRoot, readJsonBody, formatError } = ctx;

  // Scan layouts from preview-template/src/layouts — or, task-137, from the
  // opened local project's own src/layouts (?source=local&path=<dir>).
  server.middlewares.use('/__sq/scan-layouts', async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      let layoutsDir: string;
      if (url.searchParams.get('source') === 'local') {
        const dir = url.searchParams.get('path') || '';
        if (!dir || !existsSync(dir)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unknown project folder' }));
          return;
        }
        layoutsDir = path.join(dir, 'src', 'layouts');
      } else {
        const previewTemplateRoot = path.join(projectRoot, '..', 'preview-template');
        layoutsDir = path.join(previewTemplateRoot, 'src', 'layouts');
      }
      const { discoverLayouts } = await import('../layout-discovery.js');
      const layouts = await discoverLayouts(layoutsDir);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(layouts));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  // Save (create/update) a layout file
  server.middlewares.use('/__sq/save-layout', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = (await readJsonBody(req)) as { name: string; astroContent: string };
      const { name, astroContent } = body;
      if (!name || !astroContent) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing name or astroContent' }));
        return;
      }
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid layout name' }));
        return;
      }
      const layoutsDir = path.join(projectRoot, '..', 'preview-template', 'src', 'layouts');
      await mkdir(layoutsDir, { recursive: true });
      const filePath = path.join(layoutsDir, `${name}.astro`);
      await writeFile(filePath, astroContent, 'utf-8');
      server.ws.send({ type: 'custom', event: 'sq:layouts-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, path: `${name}.astro` }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  server.middlewares.use('/__sq/layout-prop', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = (await readJsonBody(req)) as { layoutName: string; op: 'add' | 'remove'; propName: string };
      const { layoutName, op, propName } = body;
      if (!layoutName || (op !== 'add' && op !== 'remove') || !propName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing layoutName, op, or propName' }));
        return;
      }
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(layoutName)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid layout name' }));
        return;
      }
      const layoutsDir = path.join(projectRoot, '..', 'preview-template', 'src', 'layouts');
      const filePath = path.join(layoutsDir, `${layoutName}.astro`);
      let source: string;
      try {
        source = await readFile(filePath, 'utf-8');
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Layout "${layoutName}" not found` }));
        return;
      }
      const result = applyLayoutPropOp(source, { op, propName });
      if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      await writeFile(filePath, result.source, 'utf-8');
      server.ws.send({ type: 'custom', event: 'sq:layouts-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  // Delete a layout file; blocks deletion if any page imports it.
  server.middlewares.use('/__sq/delete-layout', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = (await readJsonBody(req)) as { name: string };
      const { name } = body;
      if (!name || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid layout name' }));
        return;
      }
      const previewTemplateRoot = path.join(projectRoot, '..', 'preview-template');
      const layoutsDir = path.join(previewTemplateRoot, 'src', 'layouts');
      const pagesDir = path.join(previewTemplateRoot, 'src', 'pages');
      const absolutePath = path.join(layoutsDir, `${name}.astro`);

      if (!existsSync(absolutePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Layout file not found' }));
        return;
      }

      const references = await findLayoutReferences(pagesDir, name);
      if (references.length > 0) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Layout is in use', references }));
        return;
      }

      const content = await readFile(absolutePath, 'utf-8');
      await unlink(absolutePath);
      server.ws.send({ type: 'custom', event: 'sq:layouts-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, content }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });

  // Rename a layout file and rewrite imports/tags across all pages.
  server.middlewares.use('/__sq/rename-layout', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = (await readJsonBody(req)) as { oldName: string; newName: string };
      const { oldName, newName } = body;
      const nameRe = /^[A-Za-z][A-Za-z0-9_-]*$/;
      if (!oldName || !newName || !nameRe.test(oldName) || !nameRe.test(newName)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid layout name' }));
        return;
      }
      if (oldName === newName) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }
      const previewTemplateRoot = path.join(projectRoot, '..', 'preview-template');
      const layoutsDir = path.join(previewTemplateRoot, 'src', 'layouts');
      const pagesDir = path.join(previewTemplateRoot, 'src', 'pages');
      const oldPath = path.join(layoutsDir, `${oldName}.astro`);
      const newPath = path.join(layoutsDir, `${newName}.astro`);

      if (!existsSync(oldPath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Layout file not found' }));
        return;
      }
      if (existsSync(newPath)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Target layout name already exists' }));
        return;
      }

      await rename(oldPath, newPath);
      await rewriteLayoutReferences(pagesDir, oldName, newName);

      server.ws.send({ type: 'custom', event: 'sq:layouts-changed', data: {} });
      server.ws.send({ type: 'custom', event: 'sq:pages-changed', data: {} });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: formatError(err) }));
    }
  });
}
