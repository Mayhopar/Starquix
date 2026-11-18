export type ImageFillFit = 'cover' | 'contain' | 'fill' | 'none';
export type ImageFillPosition = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'left-top' | 'left-bottom' | 'right-top' | 'right-bottom';
export type ImageFillChange =
  | { type: 'replace'; src: string; variant?: string }
  | { type: 'fit'; value: ImageFillFit; variant?: string }
  | { type: 'position'; value: ImageFillPosition; variant?: string }
  | { type: 'description' | 'color' | 'gradient'; value: string; variant?: string }
  | { type: 'remove'; variant?: string };
export interface ImageFillRequest { expectedTag: string; change: ImageFillChange; preserveMaxWidth?: true; /** The rendered box; a converted container re-states it (aspect / width) when the author did not size it. */ box?: { width: number; height: number } }
export interface AttributeSpan { name: string; start: number; end: number; valueStart: number | null }
export function asciiAttributeName(name: string): string;
export function openingTagAttributes(tag: string): { insertPos: number; attributes: AttributeSpan[]; spreads: { start: number; end: number }[]; endOffset: number };
export function imageFillUrlToken(src: string): string;
/** The rendered box as Tailwind (`w-[Wpx]`, `aspect-[w/h]`) for the dimensions the author did not size. */
export function boxClasses(box: { width: number; height: number } | null | undefined, sized: { width: boolean; height: boolean }): string[];
export function readImageFillSource(content: string, location: { line: number; column: number }): { expectedTag: string; offset: number; endOffset: number; ancestors: string[] };
export function inspectImageFillTag(tag: string): {
  src: string; classes: string; description: string; retained: string[];
  fit: ImageFillFit; imagePosition: ImageFillPosition; width: boolean; height: boolean;
  fitting: Map<string, ImageFillFit>; position: Map<string, ImageFillPosition>;
  parsed: ReturnType<typeof openingTagAttributes>; attrs: Map<string, AttributeSpan>;
};
export function normalizeImageFillSource(content: string, location: { line: number; column: number }, request: ImageFillRequest): string;

export function inspectImageFillContainerTag(tag: string): { parsed: ReturnType<typeof openingTagAttributes>; attrs: Map<string, AttributeSpan>; src: string; classes: string; description: string };
