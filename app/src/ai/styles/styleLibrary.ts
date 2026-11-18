// Style library: bundled themes (committed artifact) + global custom themes
// + per-project active style. Replaces the old freeform style prompt field.
//
// themes.json is ~2MB — loaded lazily (loadBundledThemes) so it never lands in
// the main bundle. Callers that need bundled themes await the load once; the
// sync accessors return what has been loaded so far (custom themes and the
// active ref are always available).

export type StyleTheme = { id: string; name: string; markdown: string };

const CUSTOM_KEY = 'starquix:ai-custom-themes';
const activeKey = (projectId: string) => `sq:ai-style:${projectId}`;

let bundled: StyleTheme[] = [];
let bundledPromise: Promise<StyleTheme[]> | null = null;

/** Kick off (or reuse) the lazy themes.json load. Idempotent. */
export function loadBundledThemes(): Promise<StyleTheme[]> {
  bundledPromise ??= import('./themes.json').then(m => {
    bundled = (m.default as { themes: StyleTheme[] }).themes;
    return bundled;
  });
  return bundledPromise;
}

/** Bundled themes loaded so far — empty until loadBundledThemes resolves. */
export function listBundledThemes(): StyleTheme[] {
  return bundled;
}

export function listCustomThemes(): StyleTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCustom(themes: StyleTheme[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(themes));
  } catch {
    // localStorage unavailable
  }
}

/** Create (no id) or update (with id). Returns the saved theme. */
export function saveCustomTheme(input: { id?: string; name: string; markdown: string }): StyleTheme {
  const themes = listCustomThemes();
  const existing = input.id ? themes.find(t => t.id === input.id) : undefined;
  const theme: StyleTheme = {
    id: existing?.id ?? crypto.randomUUID(),
    name: input.name,
    markdown: input.markdown,
  };
  writeCustom(existing ? themes.map(t => (t.id === theme.id ? theme : t)) : [...themes, theme]);
  return theme;
}

/** ⌘Z of a delete: the exact theme back at its place (same id, so an active ref resolves again). */
export function restoreCustomTheme(theme: StyleTheme, index: number): void {
  const themes = listCustomThemes();
  if (themes.some(t => t.id === theme.id)) return;
  writeCustom([...themes.slice(0, index), theme, ...themes.slice(index)]);
}

export function deleteCustomTheme(id: string): void {
  writeCustom(listCustomThemes().filter(t => t.id !== id));
  // Active refs elsewhere dangle on purpose; resolver treats dangling as no style.
}

/** Active style ref: 'bundled:<id>' | 'custom:<id>' | null. */
export function getActiveStyleId(projectId: string): string | null {
  if (!projectId) return null;
  try {
    return localStorage.getItem(activeKey(projectId));
  } catch {
    return null;
  }
}

export function setActiveStyleId(projectId: string, ref: string | null): void {
  if (!projectId) return;
  try {
    if (ref) localStorage.setItem(activeKey(projectId), ref);
    else localStorage.removeItem(activeKey(projectId));
  } catch {
    // ignore
  }
}

function resolve(projectId: string): StyleTheme | null {
  const ref = getActiveStyleId(projectId);
  if (!ref) return null;
  const [kind, ...rest] = ref.split(':');
  const id = rest.join(':');
  const pool = kind === 'bundled' ? listBundledThemes() : kind === 'custom' ? listCustomThemes() : [];
  return pool.find(t => t.id === id) ?? null; // dangling → no style
}

export type StylePreview = {
  primary: string;
  canvas: string;
  ink: string;
  font: string | null;
  swatches: string[];
};

/**
 * Best-effort visual preview data from a DESIGN.md-shaped markdown:
 * hex colors from the `colors:` block (keyed heuristics for primary/canvas/ink)
 * and the first typography fontFamily. Returns null when no hex colors exist.
 * Two regex passes over a few KB — cheap enough to run uncached; memoize at
 * the call site (useMemo) if a render path needs it repeatedly.
 */
export function extractStylePreview(markdown: string): StylePreview | null {
  const colorEntries: [string, string][] = [];
  for (const m of markdown.matchAll(/^\s*([\w-]+):\s*["']?(#[0-9a-fA-F]{3,8})\b/gm)) {
    colorEntries.push([m[1].toLowerCase(), m[2]]);
  }
  if (colorEntries.length === 0) return null;

  const byKey = (...needles: string[]): string | undefined =>
    colorEntries.find(([k]) => needles.some(n => k === n || k.includes(n)))?.[1];

  const swatches: string[] = [];
  for (const [, hex] of colorEntries) {
    if (!swatches.includes(hex)) swatches.push(hex);
    if (swatches.length >= 8) break;
  }

  const font = markdown.match(/fontFamily:\s*["']([^"']+)["']/)?.[1] ?? null;

  return {
    primary: byKey('primary', 'accent', 'brand') ?? colorEntries[0][1],
    canvas: byKey('canvas', 'background', 'surface', 'bg') ?? '#ffffff',
    ink: byKey('ink', 'body', 'text', 'foreground', 'heading') ?? '#111111',
    font,
    swatches,
  };
}

export function getActiveStyleName(projectId: string): string | null {
  return resolve(projectId)?.name ?? null;
}

/** The system-prompt section, or undefined when no style is active. */
export function getActiveStyleSection(projectId: string): string | undefined {
  const theme = resolve(projectId);
  if (!theme) return undefined;
  return [
    `## Style Prompt (ACTIVE STYLE: ${theme.name})`,
    '',
    'The user explicitly selected this style. For ALL new sections and components you create:',
    '- This style OVERRIDES the "Design Style (MANDATORY)" rules above, including the token-only color rule: use THIS style\'s palette and typography (arbitrary values like bg-[#0066cc] are allowed and expected).',
    '- Do NOT copy the look of existing page sections or of sections created earlier in this conversation — they may follow a previously active style. The CURRENT style below is the only style authority.',
    '- Leave existing sections unchanged unless the user asks to restyle them.',
    '',
    theme.markdown,
  ].join('\n');
}
