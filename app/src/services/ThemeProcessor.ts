// src/services/ThemeProcessor.ts
import JSZip from 'jszip';
import { db } from '@/db';

// ============================================================================
// Types
// ============================================================================

export interface ProcessedComponent {
  name: string;
  path: string;
  html: string;
  source: string;
  dependencies: string[];
}

export interface ProcessedFile {
  path: string;
  content: Uint8Array;
  isText: boolean;
}

export interface ProcessedTheme {
  components: ProcessedComponent[];
  files: ProcessedFile[];
}

// ============================================================================
// Constants
// ============================================================================

const MAX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILE_COUNT = 500;

export const TEXT_EXTENSIONS = new Set([
  '.astro', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx', '.txt',
  '.svg', '.xml',
]);

export const ALLOWED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav',
  '.pdf',
]);

// ============================================================================
// ZIP Processing
// ============================================================================

/** A ZIP that fails the upload checks; its message is written for the person who chose the file. */
export class ThemeZipError extends Error {}

/**
 * Process a theme ZIP file into components and file data.
 * Pure data — does not interact with IndexedDB.
 */
export async function processThemeZip(file: File): Promise<ProcessedTheme> {
  const zip = await JSZip.loadAsync(file);

  // Security: validate file count
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length > MAX_FILE_COUNT) {
    throw new ThemeZipError(`Too many files (${entries.length}). Maximum is ${MAX_FILE_COUNT}.`);
  }

  // Security: validate total uncompressed size
  let totalSize = 0;
  for (const entry of entries) {
    const data = await entry.async('uint8array');
    totalSize += data.length;
    if (totalSize > MAX_UNCOMPRESSED_SIZE) {
      throw new ThemeZipError(`Uncompressed size exceeds ${MAX_UNCOMPRESSED_SIZE / 1024 / 1024}MB limit.`);
    }
  }

  // Detect and strip common root prefix
  const prefix = detectCommonPrefix(entries.map(e => e.name));

  const components: ProcessedComponent[] = [];
  const files: ProcessedFile[] = [];

  for (const entry of entries) {
    const rawPath = entry.name;

    // Security: reject path traversal
    if (rawPath.includes('..')) {
      throw new ThemeZipError('The ZIP has files outside its own folder.');
    }

    // Strip common prefix
    const path = prefix ? rawPath.slice(prefix.length) : rawPath;
    if (!path) continue;

    // Security: check file extension
    const ext = getExtension(path);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      continue; // Skip disallowed extensions silently
    }

    const isText = TEXT_EXTENSIONS.has(ext);
    const content = await entry.async('uint8array');

    files.push({ path, content, isText });

    // Extract Astro components
    if (ext === '.astro') {
      const source = new TextDecoder().decode(content);

      if (isPageFile(path)) {
        // Page files: extract each top-level <section> as a separate component
        const sections = extractSectionsFromPage(source, path);
        components.push(...sections);
      } else if (!isDocumentLevelFile(source) && isComponentPath(path)) {
        // Standalone component files
        const html = extractHtmlFromAstro(source);
        const dependencies = extractImports(source);
        const name = extractComponentName(path);
        components.push({ name, path, html, source, dependencies });
      }
    }
  }

  return { components, files };
}

// ============================================================================
// Astro HTML Extraction
// ============================================================================

/**
 * Extract clean HTML from an Astro file for preview purposes.
 * Strips frontmatter, Astro expressions, slot tags, and directives.
 */
export function extractHtmlFromAstro(source: string): string {
  let html = source;

  // Strip frontmatter (--- ... ---)
  html = html.replace(/^---[\s\S]*?---\n?/m, '');

  // Strip `attr={expr}` WHOLE (an orphan `class=` would swallow the next
  // attribute as its value: `class= href="/"` → class="href=&quot;/&quot;"),
  // then remaining Astro expressions ({...}) — handles nested braces
  html = stripExpressionAttributes(html);
  html = stripAstroExpressions(html);

  // Strip <slot /> and <slot></slot> tags
  html = html.replace(/<slot\s*\/>/gi, '');
  html = html.replace(/<slot[^>]*>[\s\S]*?<\/slot>/gi, '');

  // Strip Astro directives (client:*, set:*, transition:*, etc.)
  html = html.replace(/\s+(client|set|transition|define|is):[a-zA-Z]+(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}))?/g, '');

  // Strip <style> and <script> tags
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Collapse whitespace
  html = html.replace(/\n{3,}/g, '\n\n').trim();

  return html;
}

/**
 * Remove `name={…}` attributes entirely (nested braces respected). Attribute
 * names may contain `:`/`.`/`@`/`-` (class:list, on:click, x-on.click).
 */
export function stripExpressionAttributes(html: string): string {
  const re = /\s+[A-Za-z_:@.][\w:.@-]*=\{/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < html.length && depth > 0) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') depth--;
      i++;
    }
    out += html.slice(last, m.index);
    last = i;
    re.lastIndex = i;
  }
  return out + html.slice(last);
}

/**
 * Strip Astro expressions ({...}) from template, handling nested braces.
 */
export function stripAstroExpressions(html: string): string {
  let result = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '{') {
      // Skip until matching closing brace
      let depth = 1;
      i++;
      while (i < html.length && depth > 0) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') depth--;
        i++;
      }
    } else {
      result += html[i];
      i++;
    }
  }
  return result;
}

// ============================================================================
// Page Section Extraction
// ============================================================================

/**
 * Check if this .astro file is a page file (lives in pages/ directory).
 */
export function isPageFile(path: string): boolean {
  return path.toLowerCase().split('/').some(p => p === 'pages');
}

/**
 * Extract each top-level <section> from a page file as a separate component.
 * Sections in Starquix-exported pages contain the actual reusable blocks.
 */
export function extractSectionsFromPage(source: string, pagePath: string): ProcessedComponent[] {
  // Strip frontmatter
  const template = source.replace(/^---[\s\S]*?---\n?/m, '');

  const components: ProcessedComponent[] = [];
  // Match top-level <section ...>...</section> blocks
  const sectionRegex = /<section\b[^>]*>[\s\S]*?<\/section>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = sectionRegex.exec(template)) !== null) {
    let html = match[0];

    // Strip Starquix editor attributes
    html = stripEditorAttributes(html);

    // Derive a name from the first heading, or fall back to "Section N"
    const name = extractSectionName(html, index);

    const pageName = extractComponentName(pagePath);
    components.push({
      name,
      path: `${pageName}/${name}.astro`,
      html,
      source: html,
      dependencies: [],
    });
    index++;
  }

  return components;
}

/**
 * Strip Starquix editor metadata attributes from HTML.
 */
export function stripEditorAttributes(html: string): string {
  return html
    .replace(/\s+data-sq-source="[^"]*"/g, '')
    .replace(/\s+data-key="[^"]*"/g, '')
    .replace(/\s+data-with-props='[^']*'/g, '')
    .replace(/\s+contenteditable='[^']*'/g, '');
}

/**
 * Extract a human-readable name from a section's first heading.
 * Falls back to "Section {index + 1}".
 */
export function extractSectionName(html: string, index: number): string {
  const headingMatch = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (headingMatch) {
    // Strip HTML tags from heading content
    const text = headingMatch[1].replace(/<[^>]+>/g, '').trim();
    if (text.length > 0) {
      // Truncate and slugify for the component name
      const words = text.split(/\s+/).slice(0, 4).join(' ');
      return words;
    }
  }
  return `Section ${index + 1}`;
}

// ============================================================================
// Import Extraction
// ============================================================================

/**
 * Parse import statements from source to build a dependency list.
 * Returns an array of import specifiers (relative paths or package names).
 */
export function extractImports(source: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(source)) !== null) {
    imports.push(match[1]);
  }

  return imports;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect a common directory prefix from a list of ZIP entry paths.
 * If all files share a single root directory, return that prefix.
 */
export function detectCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return '';

  // Check if all paths start with the same directory
  const firstSlash = paths[0].indexOf('/');
  if (firstSlash === -1) return '';

  const candidate = paths[0].slice(0, firstSlash + 1);
  const allMatch = paths.every(p => p.startsWith(candidate));

  return allMatch ? candidate : '';
}

/**
 * Path-based filter: reject .astro files in known non-component directories.
 */
export function isComponentPath(path: string): boolean {
  const parts = path.toLowerCase().split('/');
  // Reject layout and page directories
  return !parts.some(p => p === 'layouts' || p === 'pages');
}

/**
 * Content-based filter: detects document-level Astro files (layouts, pages
 * that wrap in <html>). These are not insertable components.
 */
export function isDocumentLevelFile(source: string): boolean {
  // Strip frontmatter first so we only inspect the template
  const template = source.replace(/^---[\s\S]*?---/m, '');
  return /<!doctype\s/i.test(template) ||
         /<html[\s>]/i.test(template) ||
         /<head[\s>]/i.test(template);
}

export function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return '';
  return path.slice(lastDot).toLowerCase();
}

export function extractComponentName(path: string): string {
  const fileName = path.split('/').pop() || path;
  return fileName.replace(/\.[^.]+$/, '');
}

