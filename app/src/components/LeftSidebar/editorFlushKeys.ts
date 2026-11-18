/**
 * The editor-element override sub-maps the LeftSidebar 800ms auto-flush watches
 * to schedule a write-back to source. A field MUST be listed here or edits to it
 * only flush on the next tab/component switch (the deep-observe never fires for a
 * field nobody is watching). Keep in sync with pushOverridesToSource's collectors.
 */
export const EDITOR_FLUSH_OVERRIDE_MAP_KEYS = [
  'classOverrides',
  'textOverrides',
  'markupOverrides',
  'imageOverrides',
  'linkOverrides',
  'attributeOverrides',
] as const;
