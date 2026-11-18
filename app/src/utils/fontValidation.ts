const MAX_FONT_FILE_SIZE = 5 * 1024 * 1024;
const EXT_FORMAT: Record<string, string> = {
  woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype',
};

/** Returns a human-readable error, or null if valid. Extension-based —
 *  browsers frequently report empty MIME for font files. */
export function validateFontFile(file: File): string | null {
  if (file.size > MAX_FONT_FILE_SIZE) return 'File too large. Max size is 5MB';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!(ext in EXT_FORMAT)) return 'Only WOFF2, WOFF, TTF, and OTF files are allowed';
  return null;
}

export function fontFormatForFile(fileName: string): string {
  return EXT_FORMAT[fileName.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

export function familyFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
}

/** srcUrl overrides the WC sq-asset: ref — local mode (gap-61) points at the
 *  real /fonts/ file it wrote into the user's project. */
export function buildCustomFontFaceCss(
  family: string, assetId: string, weight: number, variable: boolean, format: string,
  srcUrl?: string,
): string {
  const w = variable ? '100 900' : String(weight);
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};` +
    `font-display:swap;src:url('${srcUrl ?? `sq-asset:${assetId}`}')` +
    (format ? ` format('${format}')` : '') + `;}`;
}
