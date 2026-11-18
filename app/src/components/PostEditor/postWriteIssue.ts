import { PostSourceConflict } from '@/postmodel/frontmatterPatch';
import { issueCopy, type OperationIssue } from '@/utils/operationIssue';
import { isLocalProjectId } from '@/utils/localMode';
export function postWriteIssue(error: unknown, projectId: string | null, collection: string, slug: string): OperationIssue {
  console.error('[post write]', collection, slug, error); // the local notice below is generic; this is the cause
  if (projectId && isLocalProjectId(projectId)) return {
    code: 'write-refused', outcome: 'no-write', operation: 'post-write',
    owner: { projectId, entityKey: `${collection}/${slug}`, visit: 0 }, episode: Date.now(), recover: 'none', fallbackUsable: true,
  };
  return {
    code: error instanceof PostSourceConflict ? 'write-refused' : 'save-incomplete',
    outcome: error instanceof PostSourceConflict ? 'no-write' : 'pending',
    operation: 'post-write', owner: { projectId, entityKey: `${collection}/${slug}`, visit: 0 }, episode: Date.now(),
    recover: 'retry-save', fallbackUsable: true,
  };
}
export function postIssueCopy(issue: OperationIssue) {
  if (issue.owner.projectId && isLocalProjectId(issue.owner.projectId)) return {
    title: issue.code === 'invalid-input' ? 'Check this property' : 'This change could not be stored',
    detail: issue.code === 'invalid-input' ? 'Complete the required properties.' : 'The previous accepted change is still available.',
  };
  return { ...issueCopy(issue), detail: issue.code === 'invalid-input'
    ? 'Complete the required properties before saving.'
    : 'Your current draft is still here. Retry save to check the file before saving again.' };
}
