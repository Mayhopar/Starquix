/**
 * The `<slot>` grammar — a TYPED RE-EXPORT of the plugin's single source.
 *
 * The implementation lives in `preview-template/src/plugins/sq-slot-markup.js`
 * because the layout inline transform (sq-inline-layout.js) needs the same
 * grammar while running inside the project's instance, which cannot strip
 * TypeScript. Same pattern as `vite-plugin/component-discovery.ts`.
 *
 * A second copy here would let the canvas composer and the inline transform
 * drift on the same grammar — the parity-by-lookalike failure mode.
 */
export { SLOT_TAG_RE, SLOT_NAME_ATTR_RE, slotParts } from '../../../preview-template/src/plugins/sq-slot-markup.js';
