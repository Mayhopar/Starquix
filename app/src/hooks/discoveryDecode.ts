import type { ScannedComponent } from './useComponentLibrary';
import type { ScannedLayout } from './useLayoutLibrary';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const props = (v: unknown) => Array.isArray(v) && v.every(p => record(p)
  && typeof p.name === 'string' && typeof p.type === 'string' && typeof p.required === 'boolean'
  && (p.defaultValue === undefined || typeof p.defaultValue === 'string'));
function list<T>(value: unknown, valid: (entry: Record<string, unknown>) => boolean): T[] {
  if (!Array.isArray(value) || !value.every(entry => record(entry) && valid(entry))) throw new Error('Invalid discovery data');
  return value as T[];
}
export const decodeComponents = (value: unknown): ScannedComponent[] => list(value, c =>
  ['name', 'path', 'html', 'category'].every(key => typeof c[key] === 'string')
  && props(c.props) && strings(c.slots) && strings(c.dependencies)
  && (c.previewImage === undefined || typeof c.previewImage === 'string')
  && (c.frontmatter === undefined || typeof c.frontmatter === 'string')
  && (c.pageTemplate == null || typeof c.pageTemplate === 'string')
  && (c.contentBound === undefined || typeof c.contentBound === 'boolean')
  && (c.theme == null || typeof c.theme === 'string')
  && (c.section == null || typeof c.section === 'string')
  && (c.defaultChildren === undefined || Array.isArray(c.defaultChildren) && c.defaultChildren.every(child =>
    record(child) && typeof child.name === 'string' && (child.slotName === undefined || typeof child.slotName === 'string'))));
export const decodeLayouts = (value: unknown): ScannedLayout[] => list(value, l =>
  ['name', 'path', 'absolutePath', 'frontmatter', 'body'].every(key => typeof l[key] === 'string')
  && props(l.props) && strings(l.slots)
  && (l.source === undefined || l.source === 'built-in' || l.source === 'user-project'));
