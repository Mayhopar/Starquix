import { describe, expect, it } from 'vitest';
import { blogSlotClassProps, plumbBlogSlotClasses, SLOT_CHROME_MARKER, upgradeBlogSlotSource } from '../blogSlotChrome';
import { LIB_BLOG_SLOT, OWNER_BLOG_SLOT } from './fixtures/lists';

const STAMP = `---\n// ${SLOT_CHROME_MARKER}\n---\n`;

const OLD = `<section class="bg-stone-100 w-full p-10">
  <div class="grid grid-cols-3 gap-4" data-blog-source="posts">
    <slot name="posts">
      <BlogCard />
    </slot>
  </div>
  <div data-blog-source="pagination">
    <slot name="pagination" />
  </div>
</section>
`;
const NEW = `<section class="bg-stone-100 w-full p-10 flex-wrap">
  <div class="grid grid-cols-3 gap-4 w-full basis-full col-span-full" data-blog-source="posts">
    <slot name="posts">
      <BlogCard />
    </slot>
  </div>
  <div class="w-full basis-full col-span-full" data-blog-source="pagination">
    <slot name="pagination" />
  </div>
</section>
`;

describe('BlogSlot chrome upgrade (layout-proof pagination row, 2026-09-20)', () => {
  it('upgrades the pre-2026-09-20 library shape: full-row posts + pagination, flex-wrap on the section', () => {
    expect(upgradeBlogSlotSource(OLD)).toBe(STAMP + NEW);
  });
  it('is idempotent and the library file on disk is already canonical', () => {
    expect(upgradeBlogSlotSource(STAMP + NEW)).toBe(STAMP + NEW);
    expect(upgradeBlogSlotSource(LIB_BLOG_SLOT)).toBe(LIB_BLOG_SLOT);
  });
  it("keeps the user's own classes and only appends what is missing (grid on the section included)", () => {
    const edited = OLD.replace('bg-stone-100 w-full p-10', 'grid grid-cols-3 bg-rose-50 p-6').replace('grid grid-cols-3 gap-4', 'grid grid-cols-2 gap-8 w-full');
    const out = upgradeBlogSlotSource(edited);
    expect(out).toContain('<section class="grid grid-cols-3 bg-rose-50 p-6 flex-wrap">');
    expect(out).toContain('<div class="grid grid-cols-2 gap-8 w-full basis-full col-span-full" data-blog-source="posts">');
  });
  it('handles single quotes, a container with no class attribute, and leaves a class={expr} alone', () => {
    const src = `<section class='p-4'><div data-blog-source="posts" class={cls}></div><div data-blog-source="pagination"></div></section>`;
    expect(upgradeBlogSlotSource(src)).toBe(STAMP + `<section class="p-4 flex-wrap"><div data-blog-source="posts" class={cls}></div><div class="w-full basis-full col-span-full" data-blog-source="pagination"></div></section>`);
  });
  it("repairs the retired writer's stray tail (the file's own last bytes after </section>)", () => {
    expect(upgradeBlogSlotSource(NEW.trimEnd() + '\non>\n')).toBe(STAMP + NEW);
    expect(upgradeBlogSlotSource(NEW.trimEnd() + '\n<!-- note -->\n')).toContain('<!-- note -->'); // real content stays
  });
  it('a file without our containers is untouched apart from the section', () => {
    expect(upgradeBlogSlotSource('<section class="x"><p>hi</p></section>\n')).toBe(STAMP + '<section class="x flex-wrap"><p>hi</p></section>\n');
  });

  it('runs ONCE: a stamped file keeps classes the user removed afterwards (2026-10-05 resurrection bug)', () => {
    const once = upgradeBlogSlotSource(OLD);
    const userRemoved = once.replace(' flex-wrap', '').replace(' basis-full col-span-full', '');
    expect(upgradeBlogSlotSource(userRemoved)).toBe(userRemoved);
  });
  it('stamps after the @name line of a component header', () => {
    const head = `---\n/**\n * @category Blog\n * @name BlogSlot\n */\n---\n`;
    expect(upgradeBlogSlotSource(head + OLD)).toBe(head.replace(' * @name BlogSlot\n', ` * @name BlogSlot\n * ${SLOT_CHROME_MARKER}\n`) + NEW);
  });
});

describe('BlogSlot class props (task-244 L8/L9)', () => {

  it('plumbs the three literals into props with the same fallback; idempotent', () => {
    const out = plumbBlogSlotClasses(NEW)!;
    expect(out).toContain('<section class={Astro.props.sectionClass ?? "bg-stone-100 w-full p-10 flex-wrap"}>');
    expect(out).toContain('<div class={Astro.props.postsClass ?? "grid grid-cols-3 gap-4 w-full basis-full col-span-full"} data-blog-source="posts">');
    expect(out).toContain('<div class={Astro.props.paginationClass ?? "w-full basis-full col-span-full"} data-blog-source="pagination">');
    expect(plumbBlogSlotClasses(out)).toBe(out);
    expect(blogSlotClassProps(out)).toEqual({ section: 'sectionClass', posts: 'postsClass', pagination: 'paginationClass' });
  });

  it('the library file ships plumbed; the owner copy plumbs', () => {
    expect(plumbBlogSlotClasses(LIB_BLOG_SLOT)).toBe(LIB_BLOG_SLOT);
    const owner = plumbBlogSlotClasses(OWNER_BLOG_SLOT)!;
    expect(owner).toContain('<section class={Astro.props.sectionClass ?? "w-full mx-auto pt-[16vh] pb-[20vh] lg:w-[640px] 2xl:w-[768px] flex flex-col"}>');
  });

  it('an existing override prop name is kept (overrides-in-files plumbed the posts div as divClass)', () => {
    const pre = NEW.replace('<div class="grid', '<div class={Astro.props.divClass ?? "grid').replace('col-span-full" data-blog-source="posts"', 'col-span-full"} data-blog-source="posts"');
    const out = plumbBlogSlotClasses(pre)!;
    expect(blogSlotClassProps(out)?.posts).toBe('divClass');
  });

  it('a tag that cannot be found, or a class expression of its own → null (custom)', () => {
    expect(plumbBlogSlotClasses(NEW.replace(' data-blog-source="posts"', ''))).toBeNull();
    expect(plumbBlogSlotClasses(NEW.replace('<section class="bg-stone-100 w-full p-10 flex-wrap">', '<section class={cls}>'))).toBeNull();
    expect(blogSlotClassProps(NEW)).toBeNull();
  });

  it('the chrome upgrade never rewrites a plumbed (unstamped) copy', () => {
    const plumbed = plumbBlogSlotClasses(OLD)!;
    expect(upgradeBlogSlotSource(plumbed)).toBe(STAMP + plumbed);
  });
});

