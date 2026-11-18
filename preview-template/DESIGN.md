---
version: 1
name: Starquix
description: The Starquix theme of the built-in section library (direction D, owner-approved 2026-11-08) — the original library's stone + yellow + sky grammar with 2026 typography.
---

# Starquix theme — design contract

Reference implementations (copy their patterns, not their content): `src/components/library/Hero.astro`,
`Pricing.astro`, `Footer.astro`. Classic (`library/classic/`) is frozen — never edit it.

## Overview

The sections are the default kit every new Starquix site starts from: finished on their own, adaptable through the
Design panel. Calm warm-stone frame, the retro-futurist illustrations carry the color, **yellow is the action** (the
brand: Starquix's own buttons are yellow), sky is for small labels. Contemporary type: big, tight, left-aligned.

## Colors (Tailwind palette steps only — never hex)

| Role | Light | Dark (stone tones, never near-black) |
|---|---|---|
| Ground (page) | `bg-stone-50` | `dark:bg-stone-900` |
| Raised (the ONE emphasized card) | `bg-white` + `ring-1 ring-stone-200` | `dark:bg-stone-800` + `dark:ring-stone-700` |
| Ink (headings, values) | `text-stone-900` | `dark:text-stone-50` |
| Body | `text-stone-600` | `dark:text-stone-400` |
| Meta / small print | `text-stone-500` | `dark:text-stone-400` |
| Rules, borders | `border-stone-200` | `dark:border-stone-700` |
| **Action (primary CTA)** | `bg-yellow-400 text-stone-900 hover:bg-yellow-500` | same (yellow stays yellow) |
| Secondary button | `bg-stone-200 text-stone-900 hover:bg-stone-300` | `dark:bg-stone-700 dark:text-stone-50 dark:hover:bg-stone-600` |
| Label pill / highlight | `bg-sky-100 text-sky-800` | `dark:bg-sky-950 dark:text-sky-200` |
| Brand band (one per page at most, e.g. the footer) | `bg-yellow-400` with `text-stone-900` | same |

Never: `black`, `stone-950`, `neutral-*`, gradients, glows, colored left borders, purple/indigo.

## Typography (default stacks only: `font-sans`; no font-family overrides)

| Role | Classes |
|---|---|
| Display (hero H1) | `font-semibold leading-[0.92] tracking-[-0.045em] text-balance`, `text-[3rem] md:text-[5.5rem] xl:text-[8rem]` |
| Section H2 | `font-semibold leading-[0.95] tracking-[-0.04em] text-balance`, `text-[2.75rem] md:text-6xl xl:text-[4rem]` (closing statements up to `xl:text-[5rem]`) |
| Card / item title (H3) | `text-lg font-semibold` (or `text-xl`) |
| Body | `text-lg leading-relaxed text-pretty` (small cards: `text-base`) |
| Big numbers (prices, metrics) | `font-light tracking-[-0.05em]`, `text-6xl`–`text-7xl` (the original's light numerals) |
| Small print | `text-sm` |

Weights: 300 (numbers), 400 (body), 500 (links, pills), 600 (headings, buttons). Size jumps ≥ 3×.
No ALL-CAPS kickers, no mono labels, no "01/02/03" unless the content is a real sequence.

## Layout

- Section padding: `px-4 md:px-10 xl:px-16`, vertical `py-20 md:py-28 xl:py-32` (hero/footer may differ).
- Section head: big H2 left + 1–2 sentences right (`md:grid-cols-12`, H2 `md:col-span-7`, text `md:col-span-5`,
  `md:items-end`), or the original's intro column (`xl:grid-cols-4`, intro in the first column).
- Left-aligned everything (center only when the original layout is genuinely centered and it reads better).
- Responsive and complete at xs 375 (base, mobile-first), md 768, xl 1280. Stack on mobile.
- Rows that must line up across cards: subgrid (`md:grid-rows-[repeat(N,auto)]` on the parent, `md:row-span-N
  md:grid md:grid-rows-subgrid` on each card).

## Elevation & depth

Flat. One raised element per section at most, with the soft shadow
`shadow-[0_1px_2px_rgb(28_25_23/0.06),0_16px_40px_-16px_rgb(28_25_23/0.18)]`. Never `shadow-sm/md/lg/xl`.

## Shapes

Images `rounded-[1.25rem] md:rounded-[2rem]` (hero panel) or `rounded-2xl` (cards, thumbnails); cards `rounded-2xl`;
buttons `rounded-lg`; pills `rounded-full`; avatars `rounded-full` at ≤ 96 CSS px (they are 200×200 sources).

## Components

- **Primary CTA:** `inline-flex min-h-12 items-center justify-center rounded-lg bg-yellow-400 px-6 font-sans
  text-base font-semibold text-stone-900 no-underline transition-colors duration-150 ease-out hover:bg-yellow-500
  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900
  dark:focus-visible:outline-yellow-400` — at most ONE primary per section.
- **Secondary CTA:** same geometry, `bg-stone-200 text-stone-900 hover:bg-stone-300` + the dark tokens above.
- **Text link:** `font-medium text-stone-900 no-underline underline-offset-4 hover:underline` (+ `min-h-11
  inline-flex items-center` when it is a nav/footer target).
- **Label pill:** `inline-flex min-h-8 items-center rounded-full bg-sky-100 px-3 text-sm font-medium text-sky-800`
  (only when it carries information: "Most popular", "New: …").
- **Card:** content on the ground with rules between rows; only the emphasized card is raised (white).
- **Icons:** inline `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.5'>` sized by class
  (`size-5`/`size-6`), lucide style; never emoji, never sparkle/lightning/brain icons.

## Do's and Don'ts

Do: real copy that names outcomes ("Start a project", "See pricing"); concrete, plausible placeholder content;
illustrations from `/assets/images/content/` and avatars from `/assets/userpics/`; `dark:` on every color;
`focus-visible` rings; ≥ 44px targets on mobile.

Don't (reads as AI-made): pill eyebrow + centered hero + one accented word; identical icon-topped feature cards;
bento; gradient text; glow/grid-paper backgrounds; logo marquees; avatar + 5 stars rows; fade-up on everything;
hover-scale on cards; `transition-all`; "Unlock / Elevate / Seamless / Supercharge / all-in-one"; "© 2024";
"Column 1 / link"; fake stats; checkmark lists by default.

## Hard constraints (the editor must keep every section editable)

Tailwind v3.4 classes only (no v4-only utilities; avoid bare `border` without a color — always `border border-solid
border-<color>`, and for one side `border-0 border-t border-solid border-<color>`; avoid `shadow-sm`, `rounded-sm`,
bare `ring`, `outline-none`). No `<style>`, no `<script>`, no props, no `{expressions}`, no `.map`, no `class:list`.
One root element per section (`<section>`, `<header>`, `<footer>`, `<nav>`). Layout with flex/grid + `gap-*` (never
`space-x/y`). CTAs are `<a href='#'>`, never `<button>`. No `<li><a>` leaves: the `<a>` is the flex child. Headings
and paragraphs hold direct text (inline spans allowed). Images: `<img src='/assets/…' alt='…' width height>` with a
meaningful alt; reserve space (width/height or aspect). Preflight may be off: set `m-0` on headings/paragraphs/
figures, `list-none p-0` on lists, `no-underline` on links, `block` on images, colors on every border. Variant order
`{bp}:{dark}:{state}:` (e.g. `md:dark:hover:bg-stone-600`). Keep the frontmatter JSDoc: `@category <X>`,
`@theme starquix`, `@name <Basename>`. Keep the file basename.
