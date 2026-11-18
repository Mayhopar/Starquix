// src/ai/tools/commandRegistry.ts
// Single source of truth: every AI-callable command defined once with zod schema.
// UI dispatch, AI tools, and TypeScript types all derive from this registry.

import { z } from 'zod';
import { PAGE_SEO_FIELDS, type PageSeoField } from '@/store/seo/headSeo';
import { BREAKPOINTS, BREAKPOINT_ORDER, type Breakpoint } from '@/store/types';

/** Editorial layouts D10: the one paragraph the AI gets about the Stack source format. */
export const STACK_BODY_FORMAT = 'Layouts: wrap blocks in `<Stack>` (import is added automatically). `<Stack direction="row" ratio="1:1|2:1|1:2">` holds exactly two `<div>` children, each with a blank line after `<div>` and before `</div>`, containing markdown or `<Media/>`. `<Stack width="reading|wide|edge" class="bg-[#hex] text-[#hex]" text="auto">` is a colored passage of blocks; it may contain one row Stack, never another column Stack. Put blank lines between tags and markdown.';


// ============================================================================
// Command Category
// ============================================================================

export type CommandCategory = 'element' | 'page' | 'read' | 'variable' | 'blog' | 'structure' | 'history' | 'link' | 'image' | 'seo' | 'project' | 'instance' | 'layout';

// ============================================================================
// Registry Entry Type
// ============================================================================

export interface ToolAvailability {
  /** Pexels key configured — enables search_stock_images */
  hasPexelsKey: boolean;
  /** An image-capable gen provider resolved from AIConfig — enables generate_image */
  hasImageGen: boolean;
}

export interface CommandRegistryEntry<T extends z.ZodType = z.ZodType> {
  schema: T;
  description: string;
  category: CommandCategory;
  examples?: string[];
  /** If true, this command reads state rather than mutating it (no snapshot needed) */
  readOnly?: boolean;
  /** Omit = always available. Tool is excluded from generation when this returns false. */
  isAvailable?: (ctx: ToolAvailability) => boolean;
  /** Present = ⌘Z can't take it back (a public deploy): the tool needs `confirm: true` (commandTools.confirmGate) and
   *  otherwise answers needsConfirmation with this message — never a popup. */
  confirmMessage?: string | ((params: Record<string, unknown>) => string);
  /** Never take a batch snapshot for this tool (undo/redo, non-Yjs side effects).
   *  Enforced by the tool wrapper (takeSnapshot becomes a no-op); these
   *  executors must not dispatch Yjs commands — dispatch would still snapshot. */
  noSnapshot?: boolean;
}

// ============================================================================
// Element Commands
// ============================================================================

/** "base = 375px, sm = 640px, …" — the widths set_breakpoint and verify_layout take. */
const BREAKPOINT_WIDTHS = BREAKPOINT_ORDER.map(bp => `${bp} = ${BREAKPOINTS[bp]}px`).join(', ');

const elementCommands = {
  add_page_content: {
    schema: z.object({
      pageId: z.string().describe('Target page ID'),
      type: z.enum(['text', 'frame']).optional().default('frame').describe('Element type: "text" for headings/paragraphs, "frame" for a COMPLETE HTML section (staticMarkup REQUIRED at page root — empty containers are rejected)'),
      tag: z.enum(['h1', 'h2', 'h3', 'p', 'span']).optional().describe('HTML tag — required when type is "text"'),
      textContent: z.string().optional().describe('Text content — used with type "text"'),
      staticMarkup: z.string().optional().describe('Raw HTML markup — used with type "frame"'),
      classes: z.string().optional().describe('Tailwind CSS classes to apply to the element'),
      parentId: z.string().optional().describe('Parent element ID. Omit to add at the root of the page.'),
      index: z.number().int().min(0).optional().describe('Insert position among siblings. Omit to append at the end.'),
      beforeId: z.string().optional().describe('Insert BEFORE this existing root element id (from read_page_content). Root sections only — do not combine with parentId.'),
      afterId: z.string().optional().describe('Insert AFTER this existing root element id (from read_page_content). Root sections only — do not combine with parentId.'),
    }),
    description: 'Add a new content element to a specific page. Use type "text" with a tag for headings/paragraphs, or "frame" with staticMarkup for HTML sections. Send the COMPLETE section in ONE call — never add an empty container to fill later (page-root frames without staticMarkup are rejected). To place a reusable library component, use place_component_instance instead. This does NOT create a reusable component — use create_component for that.',
    category: 'element' as const,
    examples: [
      'Add a heading: add_page_content pageId="page-1" type="text" tag="h1" textContent="Welcome" classes="text-4xl font-bold"',
      'Add an HTML section: add_page_content pageId="page-1" type="frame" staticMarkup="<section class=\'py-16\'><p>Hello</p></section>"',
    ],
  },

  update_element_by_key: {
    schema: z.object({
      sourceKey: z.string().describe('Element source key (data-key attribute value, e.g. "src/pages/index.astro:5:1")'),
      classes: z.string().optional().describe('New Tailwind CSS class string to apply'),
      textContent: z.string().optional().describe('New text content for the element'),
    }),
    description: 'Update Tailwind CSS classes and/or text content of an element by its source key (data-key attribute). Provide classes, textContent, or both.',
    category: 'element' as const,
    examples: [
      'Make the heading blue: update_element_by_key with classes="text-blue-600 text-4xl font-bold"',
      'Change button text: update_element_by_key with textContent="Get Started"',
    ],
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Drawn Element Commands
// ============================================================================

const drawnCommands = {
  add_drawn_element: {
    schema: z.object({
      tag: z.string().describe('HTML tag (div, section, h2, p, ...)'),
      classes: z.string().optional().default('').describe('Tailwind classes'),
      textContent: z.string().optional().default('').describe('Text content'),
      parentKey: z.string().nullable().describe('Parent element key, or null for the page root'),
      insertIndex: z.number().int().min(0).optional().default(0).describe('Position among siblings'),
      pageId: z.string().optional().describe('Target page. Defaults to the current page.'),
    }),
    description: 'Draw a plain HTML element on the canvas (same as the draw tool). It never creates a blog list — use place_component_instance \"BlogSlot\" for that. To edit it afterwards, use update_element_by_key (classes/text) with the returned key.',
    category: 'element' as const,
  },

  delete_drawn_element: {
    schema: z.object({
      elementKey: z.string().describe('Drawn element key (drawn-...)'),
    }),
    description: 'Delete a drawn element. Cascades to its nested drawn children; blog-slot bindings are cleaned up.',
    category: 'element' as const,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Structure Commands (delete / move / reorder / grid)
// ============================================================================

const structureCommands = {
  delete_element: {
    schema: z.object({
      elementId: z.string().describe('Element ID (Yjs element, e.g. from read_page_content). For source-scanned elements use delete via parent instance instead.'),
    }),
    description: 'Delete an element (and its children) from a page. Only works on Yjs elements (added via the editor) — not raw source-scanned elements.',
    category: 'structure' as const,
  },

  delete_instance_child: {
    schema: z.object({
      instanceId: z.string().describe('Component instance element ID'),
      selector: z.string().describe('Child selector like "h2-0" — tag-N within the instance markup'),
    }),
    description: 'Delete a child element inside a component instance by its tag-N selector. Use read_component_content to see the instance markup first.',
    category: 'structure' as const,
  },

  move_element: {
    schema: z.object({
      pageId: z.string().describe('Page the element lives on'),
      elementKey: z.string().describe('Key of the element to move'),
      newParentKey: z.string().nullable().describe('New parent element key, or null to move to the page root'),
      insertIndex: z.number().int().min(0).describe('Position among the new parent\'s children'),
    }),
    description: 'Move an element to a new parent (reparent) at a specific position. Use null newParentKey to move it to the page root.',
    category: 'structure' as const,
  },

  reorder_page_elements: {
    schema: z.object({
      pageId: z.string(),
      elementIds: z.array(z.string()).describe('ALL root element IDs in the new order — not a partial list'),
    }),
    description: 'Reorder the root-level elements of a page. You MUST pass the complete list of root element IDs in the desired order (use read_page_content to get them all first).',
    category: 'structure' as const,
  },

  set_child_order: {
    schema: z.object({
      pageId: z.string(),
      parentKey: z.string().describe('Parent element key whose children to reorder'),
      childKeys: z.array(z.string()).describe('ALL child keys in the new order'),
    }),
    description: 'Reorder the children of a parent element. You MUST pass the complete list of child keys in the desired order — a partial list drops children.',
    category: 'structure' as const,
  },

  set_grid_placement: {
    schema: z.object({
      key: z.string().describe('Element key to place'),
      gridColumn: z.string().describe('CSS grid-column value, e.g. "2 / span 2"'),
      gridRow: z.string().describe('CSS grid-row value, e.g. "1" or "1 / span 2"'),
    }),
    description: 'Set explicit grid placement (grid-column/grid-row) on an element. Only applies when the element\'s parent is a CSS grid container.',
    category: 'structure' as const,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Page Commands
// ============================================================================

const pageCommands = {
  add_page: {
    schema: z.object({
      page: z.object({
        id: z.string().describe('Page ID (format: page-{timestamp}-{random})'),
        name: z.string(),
        rootElementIds: z.array(z.string()).default([]),
        children: z.array(z.string()).default([]),
      }),
    }),
    description: 'Create a new page in the project. The editor switches to the new page automatically — live-read and verify tools then see it.',
    category: 'page' as const,
    examples: ['Create an About page', 'Add a Contact page'],
  },

  update_page: {
    schema: z.object({
      pageId: z.string(),
      name: z.string(),
    }),
    description: 'Rename a page',
    category: 'page' as const,
    examples: ['Rename "Home" to "Landing"'],
  },

  remove_page: {
    schema: z.object({
      pageId: z.string(),
    }),
    description: 'Delete a page from the project',
    category: 'page' as const,
    examples: ['Delete the Blog page'],
  },

  set_home_page: {
    schema: z.object({
      pageId: z.string().describe('Page to make the home page (root route "/")'),
    }),
    description: 'Make a page the home page of the site. The previous home page becomes a regular page.',
    category: 'page' as const,
  },

  move_page: {
    schema: z.object({
      pageId: z.string(),
      newParentId: z.string().nullable().describe('New parent page ID, or null for the top level'),
      index: z.number().int().min(0).describe('Position among the new parent\'s children'),
    }),
    description: 'Move a page in the pages tree — change its parent and/or position.',
    category: 'page' as const,
  },

  select_page: {
    schema: z.object({
      pageId: z.string().describe('Page ID to switch the editor to'),
    }),
    description:
      'Switch the editor to a different page. The canvas re-renders and live-read tools (read_element_html, read_source_elements, verify_layout) then see THAT page. Call before reading or verifying a page that is not currently active.',
    category: 'page' as const,
    noSnapshot: true, // meta change — not undoable, matches UI page switching
    examples: ['Switch to the page you just created before verifying it: select_page pageId="page-123"'],
  },

  set_breakpoint: {
    schema: z.object({
      breakpoint: z.enum(BREAKPOINT_ORDER as [Breakpoint, ...Breakpoint[]]).describe(`Canvas width: ${BREAKPOINT_WIDTHS}`),
    }),
    description:
      'Move the canvas to another breakpoint and leave it there (the user sees it change width): when the user asks to see that width, or before set_grid_placement, which writes at the canvas breakpoint. Not for checking a width: verify_layout takes a breakpoint and returns the canvas by itself.',
    category: 'page' as const,
    noSnapshot: true, // session state — not undoable, matches the breakpoint menu
    examples: ['The user asks for the tablet view: set_breakpoint breakpoint="md"'],
  },

  edit_file: {
    schema: z.object({
      path: z.string().describe('Project file under src/, e.g. "src/layouts/Layout1.astro"'),
      oldString: z.string().describe('Exact text to replace — must occur exactly once unless replaceAll'),
      newString: z.string().describe('Replacement text'),
      replaceAll: z.boolean().optional().describe('Replace every occurrence'),
    }),
    description:
      'Edit any project source file by exact string replacement (imports, frontmatter, expressions, markup the element tools cannot reach). Read it first with read_file. Prefer update_element_by_key for classes/text. Undoable with ⌘Z.',
    category: 'page' as const,
  },

  write_file: {
    schema: z.object({
      path: z.string().describe('Project file under src/ to create or overwrite'),
      content: z.string().describe('The whole new file content'),
    }),
    description:
      'Create or overwrite a whole project file (new component, layout, page, style). A new file under src/pages is a page at once (the result names its page id). For small changes use edit_file. Undoable with ⌘Z.',
    category: 'page' as const,
  },

  open_component: {
    schema: z.object({
      file: z.string().nullable().describe('Project file of the component or layout to open (e.g. "src/components/BlogCard.astro", "src/layouts/Post.astro"); null closes it and returns to the page'),
    }),
    description:
      'Open a component or layout file as the canvas (its master view) so its OWN elements can be edited. Edits to a component\'s elements from a page never change the component file; open it here first, then read_source_elements and update_element_by_key on its keys. select_page or open_component null returns to the page.',
    category: 'page' as const,
    noSnapshot: true,
    examples: ['Restyle the blog card: open_component file="src/components/BlogCard.astro"'],
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Layout Commands
// ============================================================================

const layoutCommands = {
  read_layouts: {
    schema: z.object({}),
    description: 'List available page layouts with their configurable props.',
    category: 'layout' as const,
    readOnly: true,
  },

  apply_layout: {
    schema: z.object({
      pageId: z.string(),
      layoutName: z.string().describe('Layout name from read_layouts'),
    }),
    description: 'Apply (or replace) a page\'s layout. Page content is kept and rendered into the layout\'s slots. Props start at the layout\'s declared defaults — use set_layout_props to change them.',
    category: 'layout' as const,
  },

  detach_layout: {
    schema: z.object({
      pageId: z.string(),
    }),
    description: 'Remove the page\'s layout. Keeps the page content, removes the layout chrome (header/footer etc.).',
    category: 'layout' as const,
  },

  set_layout_props: {
    schema: z.object({
      pageId: z.string(),
      props: z.record(z.string(), z.string()).describe('Prop name → value pairs to set. Merged into existing props.'),
    }),
    description: 'Set props on the page\'s current layout (e.g. theme, width). Only provided props change. Title/description are SEO-owned — use update_page_seo for those.',
    category: 'layout' as const,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Instance Lifecycle Commands
// ============================================================================

const instanceCommands = {
  reset_instance: {
    schema: z.object({
      instanceId: z.string().describe('Component instance element ID'),
    }),
    description: 'Reset a component instance to its master source — discards local overrides AND adopts the latest source (same as the editor\'s "Reset to master" / ↻ pull).',
    category: 'instance' as const,
  },

  make_component: {
    schema: z.object({
      key: z.string().describe('Drawn root element key to convert (draw-tool elements only — "element-..." ids from add_page_content are NOT eligible; use create_component for those)'),
      pageId: z.string().optional().describe('Page the drawn element is on. Defaults to the current page.'),
      name: z.string().optional().describe('Component name (PascalCase). Files-truth projects only; defaults to <Tag>Block.'),
    }),
    description: 'Convert a drawn element (and its drawn children) into a reusable library component, replacing it with a component instance.',
    category: 'instance' as const,
  },

  create_component: {
    schema: z.object({
      name: z.string().describe('Component name, e.g. "FeatureTile" (PascalCase; deduped if taken)'),
      staticMarkup: z.string().describe('Full HTML markup of the component root (one root element)'),
      replaceElementId: z.string().optional().describe('Existing page element to replace with an instance of the new component. Omit to append a new instance at page root.'),
      pageId: z.string().optional().describe('Target page. Defaults to the current page.'),
      category: z.string().optional().describe('Folder to create the component in (single word, e.g. "Marketing"). The folder is created if it does not exist. Omit for uncategorized.'),
    }),
    description: 'Create a NEW reusable library component (Assets tab) from HTML markup and place an instance on the page. To convert an existing drawn element, use make_component; to place an existing component, use place_component_instance.',
    category: 'instance' as const,
  },

  set_component_category: {
    schema: z.object({
      componentPath: z.string().describe('Library component path (e.g. "library/Hero.astro") or component name'),
      category: z.string().nullable().describe('Folder to move the component into (any name, e.g. "Marketing pages"; created if missing). null = remove from its folder (uncategorized).'),
    }),
    description: 'Move a library component into a folder, or out of one with category null. Folders are real, persistent entries in the folder manifest — an empty one survives.',
    category: 'instance' as const,
  },

  place_component_instance: {
    schema: z.object({
      componentPath: z.string().describe('Library component path (e.g. "built-in/Hero.astro") or component name'),
      pageId: z.string().optional().describe('Target page. Defaults to the current page.'),
      targetKey: z.string().optional().describe('Files-truth: key of the element to place it in (read_source_elements) — inside it when it is a container, else right after it. Omit = end of the page.'),
      collectionName: z.string().optional().describe('BlogSlot only: bind the new list to this collection (read_collections).'),
    }),
    description: 'Place a library component on a page (same as the ⌘K picker); without targetKey it is appended at the page root. To show a collection\'s posts on a page (a blog / news / works list of cards): componentPath "BlogSlot" + targetKey + collectionName — never hand-write a list or an empty placeholder.',
    category: 'instance' as const,
  },

  push_instance_to_source: {
    schema: z.object({
      instanceId: z.string().describe('Component instance element ID'),
    }),
    description: 'Push an instance\'s local overrides back to its master .astro source — affects ALL other instances of the component (one ⌘Z in the editor takes it back). On files-truth projects instanceId is any key of an element inside the component on this page.',
    category: 'instance' as const,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Project Commands
// ============================================================================

const projectCommands = {
  rename_project: {
    schema: z.object({
      name: z.string().describe('New project name (non-empty)'),
    }),
    description: 'Rename the project. This is not undoable via Cmd+Z.',
    category: 'project' as const,
    noSnapshot: true,
  },

  export_project: {
    schema: z.object({}),
    description: 'Export the project as a downloadable Astro zip (same as the Export button). Note: drawn elements nested inside source components are dropped with a warning.',
    category: 'project' as const,
    noSnapshot: true,
  },

  deploy_project: {
    schema: z.object({
      provider: z.literal('vercel').optional().describe('Deploy target (Vercel)'),
    }),
    description: 'Deploy the project to Vercel. Publishes the site PUBLICLY — asks the user for confirmation first. Requires a stored API token (set via the Deploy modal).',
    category: 'project' as const,
    confirmMessage: () => 'Deploy the project to Vercel? This publishes the site publicly.',
    noSnapshot: true,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Link / Image / SEO Commands
// ============================================================================

const linkImageSeoCommands = {
  update_link_attribute: {
    schema: z.object({
      elementId: z.string().describe('Link element ID'),
      attribute: z.enum(['href', 'target', 'rel', 'title', 'ariaLabel']).describe('Link attribute to set. target must be one of _blank/_self/_parent/_top; rel is space-separated (e.g. "noopener noreferrer").'),
      value: z.string(),
    }),
    description: 'Update a link attribute (href, target, rel, title, ariaLabel) on a link element.',
    category: 'link' as const,
  },

  unwrap_link: {
    schema: z.object({
      elementId: z.string().describe('Wrapper-link element to unwrap — children are kept'),
    }),
    description: 'Remove a wrapper link from an element, keeping its children in place.',
    category: 'link' as const,
  },

  update_image_attribute: {
    schema: z.object({
      elementId: z.string().describe('Image element ID'),
      attribute: z.enum(['src', 'alt', 'loading']),
      value: z.string().describe('For loading: "lazy" or "eager"'),
    }),
    description: 'Update an image attribute. Use attribute "alt" to set descriptive alt text for accessibility/SEO.',
    category: 'image' as const,
  },

  search_stock_images: {
    schema: z.object({
      query: z.string().describe('Search keywords, e.g. "wireless headphones product shot white background"'),
      orientation: z.enum(['landscape', 'portrait', 'square']).optional().describe('Filter by orientation'),
      count: z.number().int().min(1).max(10).optional().describe('Candidates to return (default 5)'),
    }),
    description: 'Search Pexels stock photos. Returns candidates with alt text, dimensions and a hotlinkable url. Pick the best match by alt/dimensions and apply it with update_image_attribute attribute="src".',
    category: 'image' as const,
    readOnly: true,
    isAvailable: (ctx) => ctx.hasPexelsKey,
    examples: ['search_stock_images query="modern office desk" orientation="landscape"'],
  },

  generate_image: {
    schema: z.object({
      prompt: z.string().describe('Detailed description of the image to generate'),
      orientation: z.enum(['square', 'landscape', 'portrait']).optional().describe('Default square'),
      elementId: z.string().optional().describe('Target img element key — when set, the generated image is applied to it immediately (src + alt from the prompt), so you do NOT need a separate update_image_attribute call. ALWAYS pass this when you know which img the image is for.'),
    }),
    description: 'Generate an image with AI and store it as a project asset. Pass elementId to apply it in one step (preferred). Without elementId it returns an sq-asset: url you must apply with update_image_attribute attribute="src". Slow (~30-90s each) — when several images are needed, emit ALL generate_image calls in a SINGLE message so they run in parallel. When search_stock_images is also available, prefer it for real-world photos; otherwise use this for every image the design needs.',
    category: 'image' as const,
    noSnapshot: true,
    isAvailable: (ctx) => ctx.hasImageGen,
    examples: ['generate_image prompt="minimalist logo of a fox, flat vector, orange on white" orientation="square"'],
  },

  read_page_seo: {
    schema: z.object({
      pageId: z.string(),
    }),
    description: 'Read a page\'s SEO as it lives in the project files (its <head>, or its layout\'s props): each field\'s value, what it inherits from the layout, whether it is read-only (set by code) and the completeness todo list. Use it before and after SEO changes to verify the result without inventing user data.',
    category: 'seo' as const,
    readOnly: true,
  },

  update_page_seo: {
    schema: z.object({
      pageId: z.string(),
      field: z.enum(PAGE_SEO_FIELDS as [PageSeoField, ...PageSeoField[]]).describe('title, description (search snippet), image (share image: /uploads/… or https://…), imageAlt, noindex (true hides the page from search engines), canonical (absolute https URL), shareTitle / shareDescription (only when shares need different text)'),
      value: z.union([z.string(), z.boolean()]).describe('"" (or false) clears the page\'s own value so the layout default shows'),
    }),
    description: 'Set one SEO field of a page. Writes the project files (the page\'s <head>, or a prop on its layout — the layout learns the prop when needed; other pages are unchanged), one ⌘Z.',
    category: 'seo' as const,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// History Commands (undo / redo)
// ============================================================================

const historyCommands = {
  undo: {
    schema: z.object({}),
    description: 'Undo the last change (same stack as the user\'s Cmd+Z). Only usable BEFORE making any changes in the current request — if you already changed something this turn, tell the user to press Cmd+Z instead.',
    category: 'history' as const,
    noSnapshot: true,
  },

  redo: {
    schema: z.object({}),
    description: 'Redo the last undone change (same stack as the user\'s Cmd+Shift+Z). Only usable BEFORE making any changes in the current request.',
    category: 'history' as const,
    noSnapshot: true,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Read Commands (read-only state queries)
// ============================================================================

const readCommands = {
  read_source_elements: {
    schema: z.object({}),
    description: 'Read all registered source elements and their current Tailwind classes. Returns sourceKey values that can be used with update_element_by_key. Call this first when no Context Elements are provided.',
    category: 'read' as const,
    readOnly: true,
    examples: ['Discover what elements are available before making class changes'],
  },

  read_page_content: {
    schema: z.object({
      pageId: z.string().describe('Page ID to read elements from'),
    }),
    description: 'Read all structured elements on a specific page (elements added via the editor, not source file elements). Use read_source_elements instead when you need sourceKeys for update_element_by_key.',
    category: 'read' as const,
    readOnly: true,
    examples: ['Read what elements are on the home page'],
  },

  read_component_content: {
    schema: z.object({
      elementId: z.string().describe('Element ID to read markup from'),
    }),
    description: 'Read the full HTML markup of a specific element',
    category: 'read' as const,
    readOnly: true,
    examples: ['Read the hero section HTML to understand its structure'],
  },

  // Registry tools (not MCP extras) since task-267: the chat edits files too,
  // and edit_file tells the model to read first.
  list_files: {
    schema: z.object({ prefix: z.string().optional().describe('Only paths starting with this, e.g. "src/pages/"') }),
    description: 'List the project files (paths) the editor holds. Files are the source of truth; edit them through the other tools.',
    category: 'read' as const,
    readOnly: true,
  },

  read_file: {
    schema: z.object({ path: z.string() }),
    description: 'Read one project text file by path (e.g. "src/pages/index.astro").',
    category: 'read' as const,
    readOnly: true,
  },

  read_element_html: {
    schema: z.object({
      sourceKey: z.string().optional().describe('Source key (data-key) of the element whose subtree to read. Omit to read the full page tree.'),
      maxDepth: z.number().optional().default(8).describe('Maximum nesting depth (default: 8)'),
    }),
    description: 'Read the live HTML structure of a page or a specific element — includes nested tags, Tailwind classes, data-key attributes, and visible text content. Use this to understand page layout before editing. Call without sourceKey to see the full page.',
    category: 'read' as const,
    readOnly: true,
    examples: [
      'Understand the full page: read_element_html (no args)',
      'Inspect a section: read_element_html sourceKey="src/pages/index.astro:10:1"',
    ],
  },

  verify_layout: {
    schema: z.object({
      keys: z.array(z.string()).min(1).describe('Element keys you touched this run (data-key values)'),
      breakpoint: z.enum(BREAKPOINT_ORDER as [Breakpoint, ...Breakpoint[]]).optional().describe(`Width to check: ${BREAKPOINT_WIDTHS}. Default: the one the canvas is on. For another width the canvas moves there for the check and comes back by itself.`),
    }),
    description: 'Verify rendered layout of elements you changed: sibling overlap, parent overflow, zero-size, text contrast, page horizontal scroll. Checks the breakpoint the canvas is on, or the one you pass: the canvas then moves there for the check and comes back by itself, so a phone, tablet and desktop check is three calls and no set_breakpoint. Returns findings — fix error-severity ones and re-verify. Call after mutating elements, before summarizing.',
    category: 'read' as const,
    readOnly: true,
    examples: [
      'After editing a section: verify_layout keys=["src/pages/index.astro:10:1"]',
      'The same section on a phone: verify_layout keys=["src/pages/index.astro:10:1"] breakpoint="base"',
    ],
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Variable Commands
// ============================================================================

/** Reusable value schema for variable write operations */
const variableValueSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('color'),
    hex: z.string().describe('Hex color (e.g. "#3b82f6"). Include "#" prefix.'),
    opacity: z.number().min(0).max(100).optional().default(100).describe('Opacity as a percentage 0–100 (default: 100 = fully opaque)'),
  }),
  z.object({
    type: z.literal('number'),
    value: z.number(),
    unit: z.string().optional().default('px').describe('CSS unit: px, rem, %, em, etc. Pass "" for a number with no unit (a font weight, line height, opacity, z-index) — left out, it is px.'),
  }),
  z.object({
    type: z.literal('string'),
    value: z.string(),
  }),
]);

const variableCommands = {
  read_variables: {
    schema: z.object({
      collectionId: z.string().optional().describe('Filter to a specific collection ID. Omit to read all collections.'),
    }),
    description: 'Read design variable collections — names, IDs, modes, and current values. Use this to discover available CSS custom properties (e.g. --primary, --spacing) and their IDs before updating them.',
    category: 'variable' as const,
    readOnly: true,
    examples: [
      'See all variables: read_variables',
      'Read one collection: read_variables collectionId="coll-abc"',
    ],
  },

  update_variable_value: {
    schema: z.object({
      collectionId: z.string().describe('Collection ID (from read_variables or auto-context)'),
      variableId: z.string().describe('Variable ID (from read_variables or auto-context)'),
      modeId: z.string().optional().describe('Mode ID to update. Omit to update the default mode.'),
      value: variableValueSchema,
    }),
    description: 'Update the value of a design variable in a specific mode. Use read_variables or check the auto-context for variable IDs.',
    category: 'variable' as const,
    examples: [
      'Change primary color: update_variable_value collectionId="..." variableId="..." value={type:"color", hex:"#3b82f6"}',
      'Change spacing: update_variable_value collectionId="..." variableId="..." value={type:"number", value:24, unit:"px"}',
    ],
  },

  create_variable: {
    schema: z.object({
      collectionId: z.string().describe('Collection ID to add the variable to'),
      name: z.string().describe('Variable name WITHOUT "--" prefix (e.g. "primary", not "--primary")'),
      type: z.enum(['color', 'number', 'string']),
      value: variableValueSchema.describe('Initial value applied to all modes'),
    }),
    description: 'Create a new design variable in an existing collection. The variable becomes available as a CSS custom property (--name) usable in Tailwind arbitrary values like bg-[var(--name)].',
    category: 'variable' as const,
    examples: [
      'Add accent color: create_variable collectionId="..." name="accent" type="color" value={type:"color", hex:"#f59e0b"}',
    ],
  },

  delete_variable: {
    schema: z.object({
      collectionId: z.string().describe('Collection ID'),
      variableId: z.string().describe('Variable ID to delete'),
    }),
    description: 'Delete a design variable from a collection. This removes the CSS custom property and may break Tailwind classes that reference it.',
    category: 'variable' as const,
    examples: ['Remove unused variable: delete_variable collectionId="..." variableId="..."'],
  },

  create_variable_collection: {
    schema: z.object({
      name: z.string().describe('Collection name (e.g. "Brand", "Spacing")'),
    }),
    description: 'Create a new variable collection (with default Light/Dark modes, no variables). Use this first on a fresh project — create_variable requires an existing collection. Returns the new collectionId.',
    category: 'variable' as const,
  },

  delete_variable_collection: {
    schema: z.object({
      collectionId: z.string().describe('Collection ID to delete'),
    }),
    description: 'Delete an entire variable collection. WARNING: removes all its variables and their CSS custom properties — classes referencing them will break.',
    category: 'variable' as const,
  },

  add_variable_mode: {
    schema: z.object({
      collectionId: z.string().describe('Collection to add the mode to'),
      name: z.string().describe('Mode name (e.g. "Dark", "Compact")'),
    }),
    description: 'Add a new mode to a variable collection — this is how you add a dark mode or theme variant. Existing variables have no value for the new mode until you set one with update_variable_value.',
    category: 'variable' as const,
  },

  rename_variable_mode: {
    schema: z.object({
      collectionId: z.string(),
      modeId: z.string().describe('Mode ID (from read_variables)'),
      name: z.string().describe('New mode name'),
    }),
    description: 'Rename a mode in a variable collection.',
    category: 'variable' as const,
  },

  rename_variable: {
    schema: z.object({
      collectionId: z.string(),
      variableId: z.string(),
      name: z.string().describe('New variable name WITHOUT "--" prefix (e.g. "primary", not "--primary")'),
    }),
    description: 'Rename a design variable. Tailwind classes referencing the old var(--name) are NOT rewritten automatically.',
    category: 'variable' as const,
  },

  retype_variable: {
    schema: z.object({
      collectionId: z.string(),
      variableId: z.string(),
      newType: z.enum(['color', 'number', 'string']),
    }),
    description: 'Change a design variable\'s type. Existing values are reset to the new type\'s default.',
    category: 'variable' as const,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Blog / Collection Commands
// ============================================================================

const blogCommands = {
  // --- Read tools ---

  read_collections: {
    schema: z.object({
      collectionName: z.string().optional().describe('Filter to a specific collection name. Omit to list all.'),
    }),
    description: 'List all content collections with their fields. Call this to discover available collections before creating posts or binding slots.',
    category: 'blog' as const,
    readOnly: true,
  },

  read_collection_posts: {
    schema: z.object({
      collectionName: z.string().describe('Collection name to list posts from'),
    }),
    description: 'List all posts in a collection with their frontmatter fields. Use this to inspect existing content before creating or updating posts.',
    category: 'blog' as const,
    readOnly: true,
  },

  read_blog_slots: {
    schema: z.object({
      pageId: z.string().optional().describe('Page ID to inspect; defaults to the current page'),
    }),
    description: 'List every blog slot (BlogSlot) on the current page in page order — each with its `slot` number (pass it to bind_blog_collection / update_blog_settings / unbind_blog_slot), collection binding and display settings.',
    category: 'blog' as const,
    readOnly: true,
  },

  read_blog_card_template: {
    schema: z.object({
      slotKey: z.string().describe('Blog slot key (e.g. drawn-1234567890-xxxxx)'),
    }),
    description: 'Get the blog card template structure with current Tailwind classes per selector. Use this before calling update_blog_card_classes to see what selectors exist and their current styles.',
    category: 'blog' as const,
    readOnly: true,
  },

  read_post_page: {
    schema: z.object({
      pageId: z.string().describe('Post page ID to read bindings for'),
    }),
    description: 'Get the collection binding and field-to-element bindings for a post page template.',
    category: 'blog' as const,
    readOnly: true,
  },

  // --- Write tools ---

  create_collection: {
    schema: z.object({
      name: z.string().describe('Collection name (e.g. "blog", "projects")'),
      fields: z.array(z.object({
        name: z.string().describe('Field name (e.g. "title", "date", "thumbnail")'),
        type: z.enum(['text', 'date', 'image', 'url', 'boolean', 'list']).describe('Field type'),
      })).optional().describe('Custom fields. Omit to use defaults: title(text), date(date), description(text), thumbnail(image)'),
    }),
    description: 'Create a new content collection with fields and register it in the content config.',
    category: 'blog' as const,
  },

  create_post: {
    schema: z.object({
      collectionName: z.string().describe('Collection to add the post to'),
      slug: z.string().describe('URL slug — lowercase, hyphens only (e.g. "my-first-post")'),
      frontmatter: z.record(z.string(), z.string()).describe('Post frontmatter as key-value pairs. All field values must be strings.'),
      body: z.string().optional().describe(`MDX body content. Omit for an empty post. ${STACK_BODY_FORMAT}`),
    }),
    description: 'Create a new blog post (MDX) in a collection. Supports <Stack> layouts — see the body field.',
    category: 'blog' as const,
  },

  update_post: {
    schema: z.object({
      collectionName: z.string(),
      slug: z.string().describe('Slug of the post to update'),
      frontmatter: z.record(z.string(), z.string()).optional().describe('Frontmatter fields to merge into the existing post. Only provided keys are updated.'),
      body: z.string().optional().describe(`New MDX body content. Omit to keep existing body. ${STACK_BODY_FORMAT}`),
    }),
    description: "Update an existing post's frontmatter and/or body. Merges provided frontmatter with existing — you don't need to provide all fields. Supports <Stack> layouts — see the body field.",
    category: 'blog' as const,
  },

  delete_post: {
    schema: z.object({
      collectionName: z.string(),
      slug: z.string().describe('Slug of the post to delete'),
    }),
    description: 'Delete a blog post file (⌘Z in the editor brings it back).',
    category: 'blog' as const,
  },

  update_blog_card_classes: {
    schema: z.object({
      slotKey: z.string().describe('Blog slot key'),
      selector: z.string().describe('Card element selector (e.g. "h3-0", "p-0", "article-0"). Get selectors from read_blog_card_template.'),
      classes: z.string().describe('Full Tailwind class string to apply to this selector'),
    }),
    description: 'Change Tailwind classes on a blog card child element. Use read_blog_card_template first to discover available selectors. Classes apply at the base breakpoint — use responsive prefixes (e.g. md:text-xl) within the class string for responsive behavior.',
    category: 'blog' as const,
  },

  update_blog_settings: {
    schema: z.object({
      slotKey: z.string().describe('Blog slot key'),
      layout: z.enum(['grid', 'list']).optional().describe('Card layout mode'),
      columns: z.number().int().min(1).max(6).optional().describe('Number of columns in grid layout'),
      gap: z.string().optional().describe('Tailwind gap class (e.g. "gap-4", "gap-8")'),
      pagination: z.enum(['none', 'numbered', 'load-more']).optional().describe('Pagination style'),
      postsPerPage: z.number().int().min(1).optional().describe('How many posts to show per page'),
      sortBy: z.enum(['date-desc', 'date-asc', 'title-asc', 'title-desc']).optional().describe('Post sort order'),
      postLinkMode: z.string().optional().describe('"auto" (link to post page), "none" (no links), or a field name to use as the link URL'),
      limit: z.number().int().min(1).nullable().optional().describe('Show at most N posts (null = all)'),
      filter: z.string().nullable().optional().describe('Boolean field: show only posts where it is true; "!field" = only posts where it is NOT true (null = all posts)'),
      slot: z.number().int().min(1).optional().describe('Which BlogSlot on the page: 1 = the first in page order (read_blog_slots lists them with their slot); default 1'),
    }),
    description: 'Update blog slot display settings. Only provide the settings you want to change.',
    category: 'blog' as const,
  },

  bind_blog_collection: {
    schema: z.object({
      slotKey: z.string().describe('Blog slot key'),
      collectionName: z.string().describe('Name of the collection to bind to this slot'),
      slot: z.number().int().min(1).optional().describe('Which BlogSlot on the page: 1 = the first in page order (read_blog_slots lists them with their slot); default 1'),
    }),
    description: 'Connect a blog slot to a content collection so it displays posts from that collection.',
    category: 'blog' as const,
  },

  add_collection_field: {
    schema: z.object({
      collectionName: z.string().describe('Collection to add the field to'),
      fieldName: z.string().describe('New field name (e.g. "tags", "author")'),
      fieldType: z.enum(['text', 'date', 'image', 'url', 'boolean', 'list']),
    }),
    description: 'Add a field to a content collection schema. Existing posts do not get the field until you update them.',
    category: 'blog' as const,
  },

  rename_collection_field: {
    schema: z.object({
      collectionName: z.string(),
      fieldName: z.string().describe('Current field name'),
      newName: z.string().describe('New field name'),
    }),
    description: 'Rename a field in a content collection schema. Post frontmatter keys are NOT rewritten — update posts separately if needed.',
    category: 'blog' as const,
  },

  delete_collection_field: {
    schema: z.object({
      collectionName: z.string(),
      fieldName: z.string().describe('Field to delete'),
    }),
    description: 'Delete a field from a content collection schema. Bindings to this field stop resolving.',
    category: 'blog' as const,
  },

  rename_collection: {
    schema: z.object({
      collectionName: z.string().describe('Current collection name'),
      newName: z.string().describe('New collection name'),
    }),
    description: 'Rename a content collection and update the content config.',
    category: 'blog' as const,
  },

  delete_collection: {
    schema: z.object({
      collectionName: z.string().describe('Collection to delete'),
    }),
    description: 'Delete a content collection. WARNING: cascades — deletes its post pages and unbinds its blog slots. Markdown post files on disk are NOT deleted.',
    category: 'blog' as const,
  },

  bind_content_field: {
    schema: z.object({
      elementKey: z.string().describe('Element key to bind (e.g. a heading inside the post template)'),
      slotKey: z.string().describe('Blog slot key the element belongs to'),
      fieldName: z.string().describe('Collection field name to bind (e.g. "title")'),
    }),
    description: 'Bind an element inside a blog slot to a collection field so it renders the field value per post.',
    category: 'blog' as const,
  },

  unbind_blog_slot: {
    schema: z.object({
      slotKey: z.string().describe('Blog slot key to unbind'),
      slot: z.number().int().min(1).optional().describe('Which BlogSlot on the page: 1 = the first in page order (read_blog_slots lists them with their slot); default 1'),
    }),
    description: 'Disconnect a blog slot from its collection. The slot keeps its display settings and shows a blank placeholder card until re-bound.',
    category: 'blog' as const,
  },

  set_post_page_binding: {
    schema: z.object({
      pageId: z.string().describe('Post page ID'),
      elementKey: z.string().describe('Element key on the post page to bind'),
      fieldName: z.string().describe('Collection field name to bind to (e.g. "title", "date", "description")'),
    }),
    description: 'Bind an element on a post page template to a collection field so it displays the field value.',
    category: 'blog' as const,
  },

} satisfies Record<string, CommandRegistryEntry>;

// ============================================================================
// Combined Registry
// ============================================================================

export const commandRegistry = {
  ...elementCommands,
  ...drawnCommands,
  ...structureCommands,
  ...pageCommands,
  ...layoutCommands,
  ...instanceCommands,
  ...projectCommands,
  ...historyCommands,
  ...linkImageSeoCommands,
  ...readCommands,
  ...variableCommands,
  ...blogCommands,
} as const;

export type CommandRegistryType = typeof commandRegistry;
export type RegisteredCommandType = keyof CommandRegistryType;

/** Tools that can't be undone (a public deploy): they take `confirm: true`, never a popup (owner 2026-11-10). */
export const CONFIRM_GATED_TOOLS = Object.entries(commandRegistry)
  .filter(([, entry]) => 'confirmMessage' in entry && entry.confirmMessage).map(([name]) => name);

/** The one rule the chat prompt and the MCP agent guide both carry: the agent asks the user, in its reply. */
export const CONFIRM_RULE = `${CONFIRM_GATED_TOOLS.join(', ')} can't be undone: pass "confirm": true ONLY when the user asked for it in this conversation; otherwise ask them in your reply.`;

/** Get all command types for a given category */
export function getCommandsByCategory(category: CommandCategory): RegisteredCommandType[] {
  return (Object.keys(commandRegistry) as RegisteredCommandType[]).filter(
    (key) => commandRegistry[key].category === category
  );
}

/** Check if a command type is registered */
export function isRegisteredCommand(type: string): type is RegisteredCommandType {
  return type in commandRegistry;
}
