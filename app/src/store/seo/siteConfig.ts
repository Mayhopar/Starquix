/**
 * Site-level SEO in the project files (design §4): the site address
 * (`site:` in astro.config — Astro's own setting; absolute share-image,
 * canonical and sitemap URLs need it), the sitemap (`@astrojs/sitemap`,
 * owner D3) and `public/robots.txt`. Pure string edits, surgical: the rest of
 * the user's config is never rewritten.
 */
import { skipJs, skipString, splitTopLevel, jsStringValue } from './astroScan';
import { SeoEditError } from './headSeo';

export const SITEMAP_PKG = '@astrojs/sitemap';
export const SITEMAP_RANGE = '^3.7.5';

interface Prop { key: string; start: number; end: number; valueStart: number }

/** The config object literal: `defineConfig({…})` or `export default {…}`. */
function configObject(cfg: string): { start: number; end: number } {
  const m = /defineConfig\s*\(\s*\{/.exec(cfg) ?? /export\s+default\s*\{/.exec(cfg);
  if (!m) throw new SeoEditError("Can't find the config object in astro.config");
  const open = m.index + m[0].length - 1;
  return { start: open, end: skipJs(cfg, open) };
}

function props(cfg: string, obj: { start: number; end: number }): Prop[] {
  const inner = cfg.slice(obj.start + 1, obj.end - 1);
  return splitTopLevel(inner).map(([piece, off]) => {
    const lead = piece.length - piece.trimStart().length;
    const key = /^\s*['"]?([A-Za-z_$][\w$]*)['"]?\s*:/.exec(piece);
    const start = obj.start + 1 + off + lead;
    return { key: key?.[1] ?? '', start, end: obj.start + 1 + off + piece.trimEnd().length, valueStart: start + (key ? key[0].length - lead : 0) };
  });
}

/** Indentation of the object's entries (or two spaces). */
function entryIndent(cfg: string, obj: { start: number }): string {
  return /\n([ \t]+)\S/.exec(cfg.slice(obj.start))?.[1] ?? '  ';
}

function insertProp(cfg: string, obj: { start: number; end: number }, text: string): string {
  const indent = entryIndent(cfg, obj);
  const multiline = cfg.slice(obj.start, obj.end).includes('\n');
  return multiline
    ? `${cfg.slice(0, obj.start + 1)}\n${indent}${text},${cfg.slice(obj.start + 1)}`
    : `${cfg.slice(0, obj.start + 1)} ${text},${cfg.slice(obj.start + 1)}`;
}

function sitemapLocal(cfg: string): string | null {
  return new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['"]${SITEMAP_PKG}['"]`).exec(cfg)?.[1] ?? null;
}

export function readSiteConfig(cfg: string | null): { site: string; sitemap: boolean } {
  if (!cfg) return { site: '', sitemap: false };
  let site = '';
  try {
    const p = props(cfg, configObject(cfg)).find((x) => x.key === 'site');
    if (p) site = jsStringValue(cfg.slice(p.valueStart, p.end)) ?? '';
  } catch { /* no config object: nothing set */ }
  const local = sitemapLocal(cfg);
  return { site, sitemap: !!local && new RegExp(`\\b${local}\\s*\\(`).test(cfg.replace(/import[^\n]*\n/g, '')) };
}

function normalizeSiteAddress(url: string): string {
  const t = url.trim().replace(/\/+$/, '');
  if (!t) return '';
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+(\/[^\s]*)?$/i.test(withScheme)) throw new SeoEditError('Site address must look like https://example.com');
  return withScheme;
}

export function setSiteAddress(cfg: string, url: string): string {
  const value = normalizeSiteAddress(url);
  const obj = configObject(cfg);
  const p = props(cfg, obj).find((x) => x.key === 'site');
  if (p) {
    if (!value) {
      // remove the entry and its comma
      let end = p.end;
      if (cfg[end] === ',') end++;
      let start = p.start;
      while (start > obj.start + 1 && /[ \t]/.test(cfg[start - 1])) start--;
      if (cfg[start - 1] === '\n') start--;
      return cfg.slice(0, start) + cfg.slice(end);
    }
    return cfg.slice(0, p.valueStart) + ` '${value}'` + cfg.slice(p.end);
  }
  return value ? insertProp(cfg, obj, `site: '${value}'`) : cfg;
}

export function setSitemap(cfg: string, on: boolean): string {
  const local = sitemapLocal(cfg);
  if (on) {
    if (readSiteConfig(cfg).sitemap) return cfg;
    let out = cfg;
    const name = local ?? 'sitemap';
    if (!local) {
      const imports = [...out.matchAll(/^import[^\n]*\n/gm)];
      const at = imports.length ? imports[imports.length - 1].index! + imports[imports.length - 1][0].length : 0;
      out = `${out.slice(0, at)}import ${name} from '${SITEMAP_PKG}';\n${out.slice(at)}`;
    }
    const obj = configObject(out);
    const integ = props(out, obj).find((x) => x.key === 'integrations');
    if (!integ) return insertProp(out, obj, `integrations: [${name}()]`);
    const open = out.indexOf('[', integ.valueStart);
    const close = skipArray(out, open);
    let q = close - 1;
    while (q > open && /\s/.test(out[q - 1])) q--;
    const empty = q === open + 1;
    const sep = empty ? '' : out[q - 1] === ',' ? ' ' : ', ';
    return `${out.slice(0, q)}${sep}${name}()${out.slice(q)}`;
  }
  if (!local) return cfg;
  let out = cfg.replace(new RegExp(`^import\\s+${local}\\s+from\\s+['"]${SITEMAP_PKG}['"];?\\n`, 'm'), '');
  const call = new RegExp(`\\b${local}\\s*\\(\\s*\\)`).exec(out);
  if (!call) return out;
  const after = /^\s*,\s*/.exec(out.slice(call.index + call[0].length));
  if (after) return out.slice(0, call.index) + out.slice(call.index + call[0].length + after[0].length);
  const before = /,\s*$/.exec(out.slice(0, call.index));
  return out.slice(0, before ? before.index : call.index) + out.slice(call.index + call[0].length);
}

function skipArray(src: string, open: number): number {
  // `[`…`]` (and nested `(`…`)`), with strings and `{…}` skipped by the scanner's own walkers
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i) - 1; continue; }
    if (ch === '{') { i = skipJs(src, i) - 1; continue; }
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') { depth--; if (depth === 0) return i + 1; }
  }
  return src.length;
}

/** package.json with `name` set to `range` (null removes it), keeping its indentation. */
export function setPackageDep(pkg: string, name: string, range: string | null): string {
  const json = JSON.parse(pkg) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...(json.dependencies ?? {}) };
  if (range === null) { if (!(name in deps)) return pkg; delete deps[name]; }
  else { if (deps[name] || json.devDependencies?.[name]) return pkg; deps[name] = range; }
  json.dependencies = Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
  const indent = /\n([ \t]+)"/.exec(pkg)?.[1] ?? '  ';
  return JSON.stringify(json, null, indent) + (pkg.endsWith('\n') ? '\n' : '');
}

/** robots.txt: created when absent; an existing one only gets its Sitemap line managed. */
export function robotsTxt(existing: string | null, sitemapUrl: string | null): string | null {
  if (existing === null) return sitemapUrl ? `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n` : null;
  const without = existing.replace(/^Sitemap:.*\n?/gim, '').replace(/\n{2,}$/, '\n');
  if (!sitemapUrl) return without;
  return `${without.replace(/\n*$/, '\n')}\nSitemap: ${sitemapUrl}\n`;
}

export const sitemapUrlOf = (site: string) => `${site.replace(/\/+$/, '')}/sitemap-index.xml`;
