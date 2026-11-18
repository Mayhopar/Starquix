import { isStorageFailure, storageFailureGuidance } from '@/services/browserStorage';
import { issueCopy, type IssueCopy, type OperationIssue } from '@/utils/operationIssue';
import { ImportValidationError, type ImportValidationCode } from './importValidation';

const validationDetail: Record<ImportValidationCode, string> = {
  'invalid-path': 'Choose the project folder again. Some file paths cannot be imported.',
  'invalid-size': 'Some files could not be read. Check that the folder is accessible, then choose it again.',
  'too-large': 'Choose a project with no more than 500 MB of included files.',
  'too-many-files': 'Choose a project with no more than 2,000 included files.',
  'duplicate-path': 'Some files have the same destination. Check the folder contents, then choose it again.',
  'missing-package': 'Choose the project folder that contains package.json.',
  'unreadable-package': 'The project’s package.json could not be read. Check the file, then try again.',
  'not-astro': 'Choose an Astro project. This folder does not declare Astro as a dependency.',
};

export function importFeedback(error: unknown, phase: 'read' | 'import'): IssueCopy {
  const validation = error instanceof ImportValidationError;
  const storage = !validation && isStorageFailure(error);
  const issue: OperationIssue = {
    code: validation ? 'invalid-input' : storage ? 'storage-unavailable' : phase === 'read' ? 'read-unavailable' : 'operation-failed',
    operation: 'import', outcome: validation || phase === 'read' ? 'no-write' : 'unknown',
    owner: { projectId: null, entityKey: 'import', visit: 0 }, episode: 0,
    recover: 'none', fallbackUsable: false,
  };
  if (validation) return { title: 'This folder could not be imported.', detail: validationDetail[error.code] };
  if (phase === 'read' && !storage) return { title: 'The selected folder could not be read.', detail: 'Your files are still selected. Check that the folder is accessible, then try again.' };
  return { ...issueCopy(issue), detail: storageFailureGuidance(error, 'import') };
}
