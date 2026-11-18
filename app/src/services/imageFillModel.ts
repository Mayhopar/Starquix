// ui-lint-exempt: Parses and generates user-document Tailwind classes.
import type { ImageFillChange } from './ViteMediaWriter';
import type { ImageFillGeometry } from './imageFillGeometry';
import { imageFillUrlToken } from '../../../preview-template/src/plugins/sq-image-fill.js';

export type FillChange = ImageFillChange | { type: 'repeat'; value: string };
export interface ImageFillState {
  target: 'native' | 'background' | 'owned' | 'unsupported';
  src: string; preview: string | null; fit: string; position: string; repeat: string; description: string;
}
const URL_CLASS = /^bg-\[url\((?:'([^']*)'|"([^"]*)"|([^)]*))\)\]$/;
const FIT_CLASS = /^bg-(cover|contain|auto|\[length:100%_100%\])$/;
const POSITION_CLASS = /^bg-(center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom)$/;
const REPEAT_CLASS = /^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/;
const GRADIENT_CLASS = /^(?:bg-gradient-|from-|via-|to-)/;
const COLOR_CLASS = /^bg-(?:transparent|white|black|[a-z]+-\d{2,3}|\[#[\da-f]+\])(?:\/\d+)?$/i;
export function backgroundFillState(classes: string): Pick<ImageFillState, 'src' | 'fit' | 'position' | 'repeat'> {
  const tokens = classes.split(/\s+/);
  const match = tokens.map(t => t.match(URL_CLASS)).find(Boolean);
  const fit = tokens.find(t => FIT_CLASS.test(t))?.slice(3);
  return { src: match?.[1] ?? match?.[2] ?? match?.[3] ?? '', fit: tokens.some(t => /^bg-\[(?:length|size):/.test(t) && t !== 'bg-[length:100%_100%]') ? 'custom' : fit === '[length:100%_100%]' ? 'fill' : fit ?? 'auto', position: tokens.some(t => /^bg-\[position:/.test(t)) ? 'custom' : tokens.find(t => POSITION_CLASS.test(t))?.slice(3) ?? 'center', repeat: tokens.find(t => REPEAT_CLASS.test(t))?.slice(3) ?? 'repeat' };
}
export function backgroundFillSupported(classes: string, geometry?: ImageFillGeometry | null, computedBackgroundImage = geometry?.backgroundImage): boolean {
  if (geometry?.imageFillInlineBackground) return false;
  const imageClasses = classes.split(/\s+/).filter(token => URL_CLASS.test(token));
  if (imageClasses.length > 1) return false;
  if (!computedBackgroundImage || computedBackgroundImage === 'none') return true;
  const src = backgroundFillState(classes).src;
  if (!src) return /bg-gradient-to-/.test(classes) && /^linear-gradient\(/.test(computedBackgroundImage) && !/\),\s*(?:url|(?:repeating-)?(?:linear|radial|conic)-gradient)\(/.test(computedBackgroundImage);
  const painted = computedBackgroundImage.match(/^url\((?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\n]*))\)$/);
  if (!painted) return false;
  try {
    const authored = new URL(src, 'https://sq.invalid');
    const computed = new URL(painted[1] ?? painted[2] ?? painted[3], 'https://sq.invalid');
    return src.startsWith('/') ? authored.pathname + authored.search === computed.pathname + computed.search : authored.href === computed.href;
  } catch { return false; }
}
function replaceTokens(classes: string, remove: RegExp, add: string): string {
  return [...classes.split(/\s+/).filter(t => t && !remove.test(t)), ...add.split(/\s+/).filter(Boolean)].join(' ');
}
export function changeBackgroundFill(classes: string, change: FillChange): string {
  if (change.type === 'replace') {
    // Fill kinds are exclusive (Figma): an image replaces the colour and the gradient.
    return replaceTokens(replaceTokens(replaceTokens(classes, URL_CLASS, ''), COLOR_CLASS, ''), GRADIENT_CLASS, imageFillUrlToken(change.src));
  }
  if (change.type === 'fit') return replaceTokens(classes, FIT_CLASS, `bg-${change.value === 'fill' ? '[length:100%_100%]' : change.value === 'none' ? 'auto' : change.value}`);
  if (change.type === 'position') return replaceTokens(classes, POSITION_CLASS, `bg-${change.value}`);
  if (change.type === 'repeat') {
    if (!['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'repeat-round', 'repeat-space'].includes(change.value)) throw new Error('Unsupported repeat');
    return replaceTokens(classes, REPEAT_CLASS, `bg-${change.value}`);
  }
  if (change.type === 'color' || change.type === 'gradient' || change.type === 'remove') {
    // Fill kinds are exclusive: a colour or a gradient replaces the image.
    let next = classes;
    for (const pattern of [URL_CLASS, FIT_CLASS, POSITION_CLASS, REPEAT_CLASS, GRADIENT_CLASS]) next = replaceTokens(next, pattern, '');
    return change.type === 'color' ? replaceTokens(next, COLOR_CLASS, change.value) : change.type === 'gradient' ? `${next} ${change.value}`.trim() : next;
  }
  return classes;
}
