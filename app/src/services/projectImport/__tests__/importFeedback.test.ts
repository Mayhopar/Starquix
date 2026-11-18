import { expect, it } from 'vitest';
import { importFeedback } from '../importFeedback';
import { ImportValidationError, prepareImportMetadata } from '../importValidation';

it('turns the actual path preflight refusal into guidance without exposing its path', () => {
  let refusal: unknown;
  try { prepareImportMetadata([{ path: 'site/../private-token/file', size: 10 }]); } catch (error) { refusal = error; }
  expect(refusal).toBeInstanceOf(ImportValidationError);
  expect(importFeedback(refusal, 'read')).toEqual({ title: 'This folder could not be imported.', detail: 'Choose the project folder again. Some file paths cannot be imported.' });
  expect(JSON.stringify(importFeedback(refusal, 'read'))).not.toContain('private-token');
});

it('explains the actual file-count limit before any import write', () => {
  let refusal: unknown;
  try { prepareImportMetadata(Array.from({ length: 2001 }, (_, i) => ({ path: `site/${i}.txt`, size: 1 }))); } catch (error) { refusal = error; }
  expect(importFeedback(refusal, 'read').detail).toContain('2,000 included files');
});

it('does not infer a validation category from arbitrary exception text', () => {
  const error = new Error('Too many files /Users/private/project token=secret');
  expect(importFeedback(error, 'read').title).toBe('The selected folder could not be read.');
  expect(JSON.stringify(importFeedback(error, 'import'))).not.toMatch(/private|token=secret|Too many files/);
});
