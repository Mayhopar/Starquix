import { expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as targets from '../postTarget';
import { ElementHeaderActions } from '../ElementHeaderActions';
import { PostEditorProvider, usePostEditor } from '@/context/PostEditorContext';
const collections = [{ name: 'works', posts: [{ slug: 'First' }, { slug: 'Timepad-Redesign' }] }];
const resolve = (paths: readonly string[]) => targets.importedPostTargetFor(paths, collections) ?? null;
it('resolves repeated links to one real filename slug, ignoring nonpost links', () => {
  expect(resolve(['/works/timepad-redesign', '/about', '/works/timepad-redesign'])).toEqual({ collection: 'works', slug: 'Timepad-Redesign' });
});
it.each([
  [], ['/about'], ['https://external.example/works/first'], ['//external.example/works/first'],
  ['/works/first', '/works/timepad-redesign'], ['/works/missing'], ['javascript:alert(1)'],
].map(paths => [paths]))('refuses external, missing, nonpost or ambiguous candidates: %j', paths => { expect(resolve(paths)).toBeNull(); });
it('refuses ambiguous slugified filenames rather than choosing a different post', () => {
  expect(targets.importedPostTargetFor(['/works/timepad-redesign'], [{ name: 'works', posts: [{ slug: 'Timepad-Redesign' }, { slug: 'timepad-redesign' }] }]) ?? null).toBeNull();
});
function Header() {
  const { openPost, editingPost } = usePostEditor();
  return <><ElementHeaderActions goToPostTarget={resolve(['/works/timepad-redesign'])} onOpenPost={openPost}
    slotKey={null} isComponentEditor={false} canResetInstance={false} showReload={false} onReset={() => {}}
    isInstanceRoot={false} isBlogSlot={false} isPostRoot={false} isDiverged={false} isPushingToSource={false}
    onPush={() => {}} canResetFromMenu={false} isDrawnElement={false} onMakeComponent={() => {}} isMakingComponent={false} />
    {editingPost && <output>{editingPost.collection}/{editingPost.slug}</output>}</>;
}
it('the existing pencil opens the exact disk post through the real PostEditor context', () => {
  render(<PostEditorProvider><Header /></PostEditorProvider>);
  fireEvent.click(screen.getByTitle('Go to post'));
  expect(screen.getByRole('status')).toHaveTextContent('works/Timepad-Redesign');
});

it('explicit Astro slug replaces the filename route and filename identity is retained', () => {
  const posts = [{ slug: 'FileA', frontmatter: { slug: 'elsewhere' } }, { slug: 'FileB', frontmatter: { slug: 'filea' } }];
  expect(targets.importedPostTargetFor(['/works/filea'], [{ name: 'works', posts }])).toEqual({ collection: 'works', slug: 'FileB' });
});
it('preserves Astro underscores and refuses unsupported filename guesses', () => {
  const posts = [{ slug: 'A_B' }, { slug: 'A-B' }];
  expect(targets.importedPostTargetFor(['/works/a-b'], [{ name: 'works', posts }])).toEqual({ collection: 'works', slug: 'A-B' });
  expect(targets.importedPostTargetFor(['/works/a_b'], [{ name: 'works', posts }])).toEqual({ collection: 'works', slug: 'A_B' });
  expect(targets.importedPostTargetFor(['/works/gr-e'], [{ name: 'works', posts }])).toBeNull();
});
it('refuses duplicate .md and .mdx filename identities and explicit route collisions', () => {
  for (const posts of [[{ slug: 'First' }, { slug: 'First' }], [{ slug: 'First' }, { slug: 'Other', frontmatter: { slug: 'first' } }]]) {
    expect(targets.importedPostTargetFor(['/works/first'], [{ name: 'works', posts }])).toBeNull();
  }
});
it('normalizes only URL encoding/trailing slash and preserves exact collection and override case', () => {
  const posts = [{ slug: 'OriginalName', frontmatter: { slug: 'Grüße' } }];
  expect(targets.importedPostTargetFor(['/works/Gr%C3%BC%C3%9Fe/', '/works/Gr%C3%BC%C3%9Fe'], [{ name: 'works', posts }])).toEqual({ collection: 'works', slug: 'OriginalName' });
  expect(targets.importedPostTargetFor(['/Works/Gr%C3%BC%C3%9Fe'], [{ name: 'works', posts }])).toBeNull();
});
it('refuses uniqueness when an unsupported competing filename could map to the same Astro route', () => {
  expect(targets.importedPostTargetFor(['/works/a-b'], [{ name: 'works', posts: [{ slug: 'A B' }, { slug: 'A-B' }] }])).toBeNull();
});
it('refuses a card when another linked collection has an unresolvable competing post route', () => {
  expect(targets.importedPostTargetFor(['/works/first', '/blog/a-b'], [
    { name: 'works', posts: [{ slug: 'First' }] }, { name: 'blog', posts: [{ slug: 'A B' }] },
  ])).toBeNull();
});
