/** Older placement/alignment assertions compare compiled markup literally.
 * Ignore only the additional version envelope; these suites still assert the
 * original coordinates, placement chains, props forwarding and splice shape.
 * sq-tagging-source-version tests exercise the unmodified emitted envelope. */
export function withoutSourceVersionEnvelope(code: string): string {
  return code
    .replace(/ data-sq-(?:source|usage)-version=\\?"[^"\n]*\\?"/g, '')
    .replace(/\$\$sqVersionSite\((\$\$sqSite\([^)]*\)),"[^"\n]*"\)/g, '$1')
    .replace(/,\$\$sqUv\(\$\$props\)/g, '');
}
