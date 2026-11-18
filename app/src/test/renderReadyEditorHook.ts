import 'fake-indexeddb/auto';
import { renderHook, waitFor, type RenderHookOptions } from '@testing-library/react';

/** Real EditorProvider children mount after its durable storage probe commits. */
export async function renderReadyEditorHook<Result, Props>(
  callback: (props: Props) => Result,
  options: RenderHookOptions<Props>,
) {
  const rendered = renderHook(callback, options);
  await waitFor(() => {
    if (rendered.result.current === null) throw new Error('Editor is still initializing');
  });
  return rendered;
}
