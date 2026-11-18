import { describe, it, expect } from 'vitest';
import { readPostLayoutSettings, writePostLayoutSettings, isPostLayoutFile } from '../postLayoutProps';
import { postRouteSource } from '../postLayoutSource';

const ROUTE = postRouteSource('blog', '../../layouts/PostLayout.astro');
const ALL_ON = { showSubtitle: true, showAuthor: true, showDate: true, showReadingTime: true, showCover: true };

describe('PostLayout invocation settings', () => {
  it('a fresh route reads as the defaults', () => {
    expect(readPostLayoutSettings(ROUTE)).toEqual({ header: 'classic', toggles: ALL_ON });
  });
  it('writes only the open tag, defaults omitted; round-trips', () => {
    const next = writePostLayoutSettings(ROUTE, { header: 'centered', toggles: { ...ALL_ON, showCover: false, showAuthor: false } })!;
    expect(next).toContain('<PostLayout post={post} header="centered" showAuthor={false} showCover={false}>\n  <Content />');
    expect(next.replace(/<PostLayout[^>]*>/, '')).toBe(ROUTE.replace(/<PostLayout[^>]*>/, ''));
    expect(readPostLayoutSettings(next)).toEqual({ header: 'centered', toggles: { ...ALL_ON, showCover: false, showAuthor: false } });
    expect(writePostLayoutSettings(next, { header: 'classic', toggles: ALL_ON })).toBe(ROUTE);
  });
  it('hand-written shapes read sensibly; unknown attributes are never rewritten', () => {
    expect(readPostLayoutSettings('<PostLayout post={post} showDate="false" header="cover">')).toEqual({ header: 'cover', toggles: { ...ALL_ON, showDate: false } });
    expect(writePostLayoutSettings('<PostLayout post={post} class="x">', { header: 'cover', toggles: ALL_ON })).toBeNull();
    expect(writePostLayoutSettings('<main />', { header: 'cover', toggles: ALL_ON })).toBeNull();
  });
});

describe('isPostLayoutFile', () => {
  it('ours in either location; nothing else', () => {
    expect(isPostLayoutFile('src/layouts/PostLayout.astro')).toBe(true);
    expect(isPostLayoutFile('src/layouts/sq/PostLayout.astro')).toBe(true);
    expect(isPostLayoutFile('src/layouts/MyPostLayout.astro')).toBe(false);
    expect(isPostLayoutFile(null)).toBe(false);
  });
});
