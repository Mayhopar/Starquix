import type { AIFailureCode } from './types';

/** Only structured provider evidence is classified. Exception text is diagnostic data. */
export function classifyAIFailure(error: unknown): AIFailureCode {
  if (error instanceof AIRequestError) return error.failure;
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const e = value as { statusCode?: unknown; status?: unknown; cause?: unknown; lastError?: unknown; errors?: unknown; code?: unknown };
    const status = typeof e.statusCode === 'number' ? e.statusCode : e.status;
    if (status === 401 || status === 403) return 'authorization';
    if (status === 402) return 'credits';
    if (status === 429) return 'rate-limit';
    if (typeof status === 'number' && (status === 0 || status >= 500 && status <= 599)) return 'connection';
    if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT') return 'connection';
    pending.push(e.cause, e.lastError);
    if (Array.isArray(e.errors)) pending.push(...e.errors);
  }
  return 'unknown';
}

export function aiFailureCopy(failure: AIFailureCode | undefined): { title: string; detail: string; settings?: boolean } {
  switch (failure) {
    case 'configuration': return { title: 'Connect an AI provider to continue.', detail: 'Your prompt is kept here. Add a provider connection in AI settings.', settings: true };
    case 'authorization': return { title: 'The provider did not accept this connection.', detail: 'Check your API key and provider access in AI settings.', settings: true };
    case 'credits': return { title: 'The provider requires more credits for this request.', detail: 'Review your provider account or choose another configured provider in AI settings.', settings: true };
    case 'rate-limit': return { title: 'The provider’s request limit was reached.', detail: 'Wait before sending another request, or choose another configured model in AI settings.', settings: true };
    case 'connection': return { title: 'The AI provider is unavailable.', detail: 'Check your connection and provider availability before sending another request.' };
    case 'save': return { title: 'Some changes have not reached the project files yet.', detail: 'Your edits are stored in this browser. Wait for the preview to catch up before continuing.' };
    default: return { title: 'The AI request could not finish.', detail: 'Review any changes already made before sending another request.' };
  }
}

/** Carries finite classification across the SDK callback boundary. No raw cause enters chat state. */
export class AIRequestError extends Error {
  constructor(readonly failure: AIFailureCode) {
    super(aiFailureCopy(failure).title);
    this.name = 'AIRequestError';
  }
}
