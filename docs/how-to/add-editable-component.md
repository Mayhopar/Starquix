# How to Add an Editable Component

Making new Astro components work with the Starquix visual editor.

## Requirements for Editability

For a component to be editable in Starquix:

1. **Source tracking** - Vite plugin injects `data-sq-source` attribute
2. **Clickable** - Bridge.js can detect clicks
3. **Classes editable** - Component accepts and applies `class` prop
4. **Text editable** (optional) - Has text content that can be edited

## How Source Tracking Works

**File:** `app/src/vite-plugin/index.ts`

The Vite plugin:
1. Parses `.astro` files during build
2. Finds all HTML elements with their line/column positions
3. Injects `data-sq-source="file:line:column"` attribute

```astro
<!-- Before (in source) -->
<div class="p-4">Hello</div>

<!-- After (in browser) -->
<div class="p-4" data-sq-source="src/components/Hero.astro:5:1">Hello</div>
```

## Step 1: Create Basic Astro Component

```astro
---
// src/components/Card.astro
interface Props {
  class?: string;
}

const { class: className = '' } = Astro.props;
---

<div class:list={["card-base", className]}>
  <slot />
</div>

<style>
  .card-base {
    /* Base styles that can be overridden */
  }
</style>
```

**Key pattern:** Accept `class` prop and merge with base classes using `class:list`.

## Step 2: Add to Page

```astro
---
// src/pages/index.astro
import Card from '../components/Card.astro';
---

<Card class="p-4 bg-white">
  <h2>Card Title</h2>
  <p>Card content goes here</p>
</Card>
```

## Step 3: Verify Source Tracking

Open browser DevTools on the iframe and check:

```javascript
// Should find your component
document.querySelector('[data-sq-source*="Card.astro"]')
```

If not found, check:
- Component is in `src/` directory
- File extension is `.astro`
- Vite dev server is running

## Handling Component Instances

When same component is used multiple times:

```astro
<Card class="bg-white">First</Card>
<Card class="bg-blue-100">Second</Card>
<Card class="bg-green-100">Third</Card>
```

Bridge.js assigns unique keys:
```
src/components/Card.astro:5:1      (first instance)
src/components/Card.astro:5:1#1    (second instance)
src/components/Card.astro:5:1#2    (third instance)
```

Changes to one instance only affect THAT instance in the source.

## Making Text Content Editable

For inline text editing to work:

1. **Element must have text content directly** (not just child elements)
2. **Element must be selectable** (has `data-sq-source`)
3. **Double-click to enter edit mode**

```astro
<!-- Editable - has direct text -->
<h1 class="text-2xl">Welcome to My Site</h1>

<!-- Editable - text in paragraph -->
<p>This paragraph can be edited.</p>

<!-- NOT directly editable - only contains children -->
<div class="container">
  <h1>Title</h1>  <!-- This child IS editable -->
  <p>Text</p>     <!-- This child IS editable -->
</div>
```

## Nested Components

Nested components work automatically:

```astro
<!-- src/components/Hero.astro -->
<section class="hero">
  <Card class="hero-card">
    <h2>Hero Title</h2>
  </Card>
</section>
```

Each level gets its own `data-sq-source`:
- `<section>` → `Hero.astro:5:1`
- `<Card>` renders `<div>` → `Card.astro:10:1`
- `<h2>` → `Hero.astro:7:5`

## Slot Content

Slot content keeps its source location from where it's defined:

```astro
<!-- In Card.astro -->
<div class="card">
  <slot />  <!-- Content comes from parent -->
</div>

<!-- In index.astro -->
<Card>
  <p>This text</p>  <!-- data-sq-source points to index.astro, not Card.astro -->
</Card>
```

## Framework Components (React/Vue/Svelte)

Framework components within Astro also work:

```astro
---
import ReactButton from './ReactButton.tsx';
---

<ReactButton className="btn-primary">Click Me</ReactButton>
```

The Vite plugin tracks the component usage in the Astro file, but the internal React DOM won't have source tracking.

**Workaround:** For deep editing, create an Astro wrapper.

## Dynamic Content

Dynamic content (loops, conditionals) creates multiple elements with same source:

```astro
{posts.map(post => (
  <article class="post">
    <h2>{post.title}</h2>
  </article>
))}
```

All `<article>` elements share source location but get unique instance keys:
- `index.astro:10:3` (first)
- `index.astro:10:3#1` (second)
- etc.

## Troubleshooting

### Component not appearing in editor

1. **Check source attribute exists:**
   ```javascript
   document.querySelector('[data-sq-source*="YourComponent"]')
   ```

2. **Check Vite plugin is processing the file:**
   - File must be in `src/`
   - File must have `.astro` extension
   - Check console for plugin errors

3. **Check component renders to DOM:**
   - Some components may render nothing initially
   - Conditional rendering may hide element

### Classes not updating

1. **Check component accepts class prop:**
   ```astro
   const { class: className } = Astro.props;
   ```

2. **Check class is applied to DOM element:**
   ```astro
   <div class={className}>  <!-- or class:list -->
   ```

3. **Check for conflicting styles:**
   - Scoped styles might override
   - CSS specificity issues

### Text editing not working

1. **Element needs direct text content**
2. **Must double-click already-selected element**
3. **Check element has no children** (containers don't allow text edit)

## Example: Full Editable Component

```astro
---
// src/components/FeatureCard.astro
interface Props {
  class?: string;
  title?: string;
  description?: string;
}

const {
  class: className = '',
  title = 'Feature Title',
  description = 'Feature description goes here.'
} = Astro.props;
---

<div class:list={["feature-card rounded-lg p-6", className]}>
  <h3 class="text-xl font-bold mb-2">{title}</h3>
  <p class="text-gray-600">{description}</p>
  <slot />
</div>
```

This component:
- Accepts `class` prop for styling
- Has editable text in `<h3>` and `<p>`
- Accepts slot for additional content
- Uses `class:list` to merge classes properly

## File Write Behavior

When you edit a component's classes in the editor:

1. **Source file is updated** at the exact line/column
2. **All instances update** in the preview
3. **HMR refreshes** the preview

```astro
<!-- Before edit -->
<Card class="p-4 bg-white">

<!-- After changing background to blue in editor -->
<Card class="p-4 bg-blue-500">
```

The Vite plugin writes directly to `src/components/Card.astro` (or wherever the element is defined).
