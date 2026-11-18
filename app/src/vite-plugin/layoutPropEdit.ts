import { extractFrontmatter, extractProps } from './component-discovery';
import { isReservedLayoutProp } from '../store/layoutReservedProps';

const IFACE_RE = /interface\s+Props\s*\{([\s\S]*?)\}/;
const DESTR_RE = /const\s*\{([^}]*)\}\s*=\s*Astro\.props/;

/** Add `name?: string` to interface Props and `name` to the Astro.props destructuring. */
export function addLayoutProp(source: string, name: string): string {
  let out = source;

  if (IFACE_RE.test(out)) {
    out = out.replace(IFACE_RE, (_full, body: string) => {
      const trimmed = body.replace(/\s+$/, '');
      return `interface Props {${trimmed}\n  ${name}?: string;\n}`;
    });
  } else {
    out = out.replace(/^---\n/, `---\ninterface Props {\n  ${name}?: string;\n}\n`);
  }

  if (DESTR_RE.test(out)) {
    out = out.replace(DESTR_RE, (_full, body: string) => {
      const names = body.split(',').map(s => s.trim()).filter(Boolean);
      if (!names.some(n => n.split('=')[0].trim() === name)) names.push(name);
      return `const { ${names.join(', ')} } = Astro.props`;
    });
  } else if (IFACE_RE.test(out)) {
    out = out.replace(IFACE_RE, (full) => `${full}\nconst { ${name} } = Astro.props;`);
  } else {
    out = out.replace(/^---\n/, `---\nconst { ${name} } = Astro.props;\n`);
  }

  return out;
}

/** Remove `name` from interface Props and from the Astro.props destructuring. */
export function removeLayoutProp(source: string, name: string): string {
  let out = source;

  if (IFACE_RE.test(out)) {
    out = out.replace(IFACE_RE, (_full, body: string) => {
      const kept = body
        .split('\n')
        .filter(line => !new RegExp(`^\\s*${name}\\??\\s*:`).test(line))
        .join('\n');
      return `interface Props {${kept}}`;
    });
  }

  if (DESTR_RE.test(out)) {
    out = out.replace(DESTR_RE, (_full, body: string) => {
      const names = body
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .filter(n => n.split('=')[0].trim() !== name);
      return `const { ${names.join(', ')} } = Astro.props`;
    });
  }

  return out;
}

/**
 * Conservative usage check: does the layout BODY (post-frontmatter) reference the
 * prop as an identifier? Used to refuse a remove that would break the template.
 */
export function layoutBodyReferencesProp(source: string, name: string): boolean {
  const frontmatter = extractFrontmatter(source);
  const body = frontmatter ? source.slice(source.indexOf('---', 3) + 3) : source;
  return new RegExp(`\\b${name}\\b`).test(body);
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export type LayoutPropOp = { op: 'add' | 'remove'; propName: string };
export type LayoutPropResult = { ok: true; source: string } | { ok: false; error: string };

export function applyLayoutPropOp(source: string, { op, propName }: LayoutPropOp): LayoutPropResult {
  if (!NAME_RE.test(propName)) return { ok: false, error: `Invalid prop name "${propName}".` };
  if (isReservedLayoutProp(propName)) return { ok: false, error: `"${propName}" is owned by SEO — edit it in the SEO tab.` };

  const declared = new Set(extractProps(extractFrontmatter(source)).map(p => p.name));

  if (op === 'add') {
    if (declared.has(propName)) return { ok: false, error: `"${propName}" already exists.` };
    return { ok: true, source: addLayoutProp(source, propName) };
  }

  // remove
  if (!declared.has(propName)) return { ok: false, error: `"${propName}" is not a prop of this layout.` };
  if (layoutBodyReferencesProp(source, propName)) {
    return { ok: false, error: `"${propName}" is used in the layout — remove it from the template first.` };
  }
  return { ok: true, source: removeLayoutProp(source, propName) };
}
