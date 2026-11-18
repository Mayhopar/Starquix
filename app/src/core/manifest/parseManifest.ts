/**
 * task-207 D2 — see types.ts for the tier model and the ledger
 * (docs/plans/2026-08-11-task-207-variant-system-design.md) for every case.
 *
 * Deliberately line-oriented over the FIRST frontmatter fence only: a
 * multiline brace-matching regex over a whole .astro file is the classic
 * catastrophic-backtracking footgun (A16), and nothing we need lives outside
 * the fence.
 *
 * This is NOT the same parser as SqComponentView's buildStubProps, on purpose
 * (D7): that one answers "what value makes this render?", this one answers
 * "what may a user edit?". Unifying them would need a generated artifact with
 * a byte-parity test for ~80 lines of regex.
 */
import { EMPTY_MANIFEST, type Control, type Manifest, type PropSpec } from './types';

/** Props that land in a class attribute or are ours, never user knobs (A13). */
const HIDDEN = /^(class|className|customClass|style|id|key|slot)$/i;

/** A prop whose NAME reads as an asset path. Anchored so `srcset` misses. */
const MEDIA_NAME = /^(src|image|img|poster|thumb|thumbnail|avatar|logo|cover|photo|picture|video)\d*$/i;

const humanize = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

interface Tags {
  media?: boolean;
  hidden?: boolean;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}

/** Tags ride a `/** … *​/` comment on the line(s) directly above the prop. */
function parseTags(comment: string): Tags {
  const t: Tags = {};
  if (/@media\b/.test(comment)) t.media = true;
  if (/@hidden\b/.test(comment)) t.hidden = true;
  const label = comment.match(/@label\s+([^@*]+)/);
  if (label) t.label = label[1].trim();
  const unit = comment.match(/@unit\s+(\S+)/);
  if (unit) t.unit = unit[1];
  for (const k of ['min', 'max', 'step'] as const) {
    const m = comment.match(new RegExp(`@${k}\\s+(-?\\d+(?:\\.\\d+)?)`));
    if (m) t[k] = Number(m[1]);
  }
  return t;
}

/** Union of string and/or number literals → enum values; else null. */
function literalUnion(type: string): (string | number)[] | null {
  const parts = type.split('|').map(p => p.trim());
  if (parts.length < 2) return null;
  const out: (string | number)[] = [];
  for (const p of parts) {
    const str = p.match(/^(['"])(.*)\1$/);
    if (str) { out.push(str[2]); continue; }
    if (/^-?\d+(\.\d+)?$/.test(p)) { out.push(Number(p)); continue; }
    return null; // `string | null` and friends are not an enum (A7)
  }
  return out;
}

function controlForType(type: string, tags: Tags, name: string): Control | null {
  const t = type.replace(/;$/, '').trim();
  const isMedia = tags.media || MEDIA_NAME.test(name);
  if (/\[\]$/.test(t) || /^(readonly )?Array</.test(t)) {
    return isMedia ? { kind: 'slots' } : null; // string[] alt arrays: no control (A6)
  }
  if (/^number$/.test(t)) {
    const c: Control = { kind: 'number', unit: tags.unit ?? 'px' };
    if (tags.min !== undefined) c.min = tags.min;
    if (tags.max !== undefined) c.max = tags.max;
    if (tags.step !== undefined) c.step = tags.step;
    return c;
  }
  if (/^boolean$/.test(t)) return { kind: 'boolean' };
  const values = literalUnion(t);
  if (values) return { kind: 'enum', values };
  // `string`, `string | null`, `string | undefined`
  if (/^string(\s*\|\s*(null|undefined))*$/.test(t)) {
    return isMedia ? { kind: 'slot' } : { kind: 'text' };
  }
  return null; // objects, generics, unknown (A6)
}

/** Tier 2: `interface Props {…}` / `type Props = {…}`. */
function parseTyped(fm: string): PropSpec[] {
  const block = fm.match(/(?:interface\s+Props|type\s+Props\s*=)\s*\{([\s\S]*?)\n\}/);
  if (!block) return [];
  const out: PropSpec[] = [];
  let pending = '';
  for (const line of block[1].split('\n')) {
    if (/^\s*(\/\*|\*|\/\/)/.test(line)) { pending += ` ${line}`; continue; }
    const m = line.match(/^\s*(\w+)\??\s*:\s*(.+?);?\s*$/);
    if (!m) { pending = ''; continue; }  // index signatures, blanks, `}`
    const [, name, type] = m;
    const tags = parseTags(pending);
    pending = '';
    if (tags.hidden || HIDDEN.test(name)) continue;
    const control = controlForType(type, tags, name);
    if (!control) continue;
    out.push({ name, label: tags.label ?? humanize(name), control });
  }
  return out;
}

/** Tier 1: `const { a, b = 'x' } = Astro.props` — names + literal defaults. */
function parseDestructured(fm: string): PropSpec[] {
  const m = fm.match(/(?:const|let)\s*\{([\s\S]*?)\}\s*=\s*Astro\.props/);
  if (!m) return [];
  const out: PropSpec[] = [];
  for (const raw of m[1].split(',')) {
    const part = raw.trim();
    if (!part || part.startsWith('...')) continue;
    // `class: cls = '…'` — the SOURCE name is what the invocation writes.
    const named = part.match(/^(\w+)\s*(?::\s*\w+)?\s*(?:=\s*([\s\S]+))?$/);
    if (!named) continue;
    const [, name, rawDefault] = named;
    if (HIDDEN.test(name)) continue;
    const spec: PropSpec = {
      name,
      label: humanize(name),
      control: MEDIA_NAME.test(name) ? { kind: 'slot' } : { kind: 'text' },
    };
    const lit = rawDefault?.trim().match(/^(['"])([\s\S]*)\1$/);
    if (lit) spec.default = lit[2];
    out.push(spec);
  }
  return out;
}

/**
 * The frontmatter BODY (no `---` fences) → manifest. This is the shape the
 * component scan already returns (`ScannedComponent.frontmatter`, produced by
 * component-discovery's extractFrontmatter), so consumers holding scan data
 * call this rather than re-wrapping fences around it.
 */
export function manifestFromFrontmatter(frontmatter: string): Manifest {
  const typed = parseTyped(frontmatter);
  if (typed.length > 0) return { props: typed };  // A3: types win
  const destructured = parseDestructured(frontmatter);
  return destructured.length > 0 ? { props: destructured } : EMPTY_MANIFEST;
}

export function parseComponentManifest(source: string): Manifest {
  const fence = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fence) return EMPTY_MANIFEST;
  return manifestFromFrontmatter(fence[1]);
}

/**
 * task-207 D11 + Task 7: the manifest for a component the scan already read.
 *
 * `fallback` is load-bearing, not defensive: only LOCAL mode scans the user's
 * folder, so in WC there is no scan entry for `sq/Media.astro` at all and the
 * inlined MEDIA_MANIFEST is the only source. Same code path in both runtimes,
 * which is D9's whole point — WC just resolves to the fallback.
 */
export function manifestForComponent(
  components: Array<{ path: string; frontmatter?: string }>,
  path: string,
  fallback: Manifest = EMPTY_MANIFEST,
): Manifest {
  const frontmatter = components.find(c => c.path === path)?.frontmatter;
  if (!frontmatter) return fallback;
  const parsed = manifestFromFrontmatter(frontmatter);
  return parsed.props.length > 0 ? parsed : fallback;
}
