/** Constructed only from the authenticated import result's explicit pre-write
 * refusal metadata. Raw error text never establishes this provenance. */
export class ImportBindingConflictError extends Error {
  readonly code = 'import-binding-conflict';
  readonly outcome = 'no-write';
}
