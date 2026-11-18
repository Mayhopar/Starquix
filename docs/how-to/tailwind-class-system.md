# Tailwind Class System

How ClassStorage, parsing, and cascading work in Starquix.

## Core Concept: ClassStorage

Classes are stored in a 4-level hierarchy:

```typescript
type ClassStorage = {
  [breakpoint: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl']: {
    [theme: 'light' | 'dark']: {
      [state: 'default' | 'hover' | 'focus' | 'active' | 'disabled']: string[]
    }
  }
}
```

**Key insight:** Classes are stored WITHOUT prefixes. Prefixes are only added during serialization.

```
Input:  'md:dark:hover:bg-blue-500'
Stored: storage['md']['dark']['hover'] = ['bg-blue-500']
```

## Quick Reference

| File | Purpose |
|------|---------|
| `core/classes/types.ts` | Type definitions |
| `core/classes/parser.ts` | parseClasses(), serializeClasses() |
| `core/classes/cascade.ts` | getEffectiveClasses() |
| `core/classes/properties.ts` | getPropertyGroup() |
| `DesignBar/DesignBar.tsx` | computeSlotContent(), UI integration |

## The Parse → Cascade → Serialize Flow

```
"p-4 md:pr-8 hover:bg-blue"
         ↓ parseClasses()
ClassStorage {
  xs:  { light: { default: ['p-4'], hover: ['bg-blue'], ... } }
  md:  { light: { default: ['pr-8'], hover: [], ... } }
  ...
}
         ↓ getEffectiveClasses(storage, 'md', 'light', 'hover')
['p-4', 'pr-8', 'bg-blue']  // What user sees for md.light.hover
         ↓ user changes 'bg-blue' to 'bg-green'
         ↓ computeSlotContent() determines what to store
storage['md']['light']['hover'] = ['bg-green']  // Only the diff!
         ↓ serializeClasses()
"p-4 md:pr-8 hover:bg-green"
```

## parseClasses(): String → Storage

**File:** `core/classes/parser.ts`

Splits class string and parses each token:

```typescript
parseToken('md:dark:hover:bg-blue-500')
// Returns: { breakpoint: 'md', theme: 'dark', state: 'hover', className: 'bg-blue-500' }

parseToken('bg-red-500')
// Returns: { breakpoint: 'xs', theme: 'light', state: 'default', className: 'bg-red-500' }
```

**Prefix order matters:** breakpoint → theme → state → className

```
✓ md:dark:hover:bg-blue    (correct order)
✗ dark:md:hover:bg-blue    (wrong - theme before breakpoint)
```

## serializeClasses(): Storage → String

**File:** `core/classes/parser.ts`

Iterates in deterministic order:
1. Breakpoints: xs (no prefix) → sm → md → lg → xl → 2xl
2. Themes: light (no prefix) → dark
3. States: default (no prefix) → hover → focus → active → disabled

```typescript
// xs.light.default has no prefix
'p-4'

// md.light.default adds only breakpoint
'md:pr-8'

// xs.light.hover adds only state
'hover:bg-blue'

// md.dark.hover adds all three
'md:dark:hover:bg-green'
```

## getEffectiveClasses(): Cascade Resolution

**File:** `core/classes/cascade.ts`

Implements Tailwind's mobile-first cascade:

```
Cascade order (later overrides earlier):
1. xs.light.default     (base styles)
2. xs.light.[state]     (base state overrides)
3. sm.light.default     (small+ overrides)
4. sm.light.[state]
5. md.light.default     (medium+ overrides)
6. ...continue for each breakpoint...
7. xs.dark.default      (dark mode overrides, if dark theme)
8. xs.dark.[state]
9. ...continue for each breakpoint in dark...
```

**Property group deduplication:** Only ONE class per property group in final result. Last one wins.

## getPropertyGroup(): Class Categorization

**File:** `core/classes/properties.ts`

Determines which CSS property a class controls:

```typescript
getPropertyGroup('bg-red-500')     // 'bg-'
getPropertyGroup('p-4')            // 'p-'
getPropertyGroup('min-w-full')     // 'min-w-'
getPropertyGroup('relative')       // 'standalone:position'
getPropertyGroup('flex')           // 'standalone:display'
getPropertyGroup('text-base')      // 'standalone:textSize' (NOT 'text-'!)
```

**Why it matters:** When setting a new class, all classes in the same group are removed:

```typescript
// Before: storage has ['bg-white', 'p-4']
// User sets 'bg-blue-500'
// Property group of 'bg-blue-500' is 'bg-'
// Remove all 'bg-' classes, then add new one
// After: ['p-4', 'bg-blue-500']
```

## computeSlotContent(): Smart Diff Storage

**File:** `DesignBar/DesignBar.tsx:206`

**Key innovation:** Only stores what DIFFERS from inherited values.

```typescript
// User at md.light.hover wants: ['p-4', 'pr-8', 'bg-green']
// Inherited would be:           ['p-4', 'pr-8', 'bg-blue']
// Difference:                   only 'bg-green' differs

// So we store only:
storage['md']['light']['hover'] = ['bg-green']
// NOT ['p-4', 'pr-8', 'bg-green'] - that would be redundant!
```

**Why?**
- Keeps Yjs documents lean
- Makes undo/redo efficient
- Clean class strings without duplicates

## DesignBar Integration Pattern

```typescript
// 1. Get classes from Yjs
const storeClasses = useElementClasses(key);

// 2. Parse into storage
const storage = useMemo(() => parseClasses(storeClasses), [storeClasses]);

// 3. Get effective classes for current context
const effectiveClasses = useMemo(() =>
  getEffectiveClasses(storage, currentBreakpoint, currentTheme, currentState),
  [storage, currentBreakpoint, currentTheme, currentState]
);

// 4. Handle changes (CRITICAL PATTERN)
const handleClassesChange = useCallback((newBlockClasses: string) => {
  const newTokens = newBlockClasses.split(/\s+/).filter(Boolean);

  // IMPORTANT: Get FRESH classes from Yjs, not stale React state
  const freshClasses = getClassesFromYjs(key);
  const baseStorage = parseClasses(freshClasses);
  const newStorage = cloneStorage(baseStorage);

  // Compute what to store (only diffs)
  const slotContent = computeSlotContent(
    newStorage, currentBreakpoint, currentTheme, currentState, newTokens
  );

  newStorage[currentBreakpoint][currentTheme][currentState] = slotContent;

  // Serialize and persist
  const finalClasses = serializeClasses(newStorage);
  setClasses(key, finalClasses);
}, [key, currentBreakpoint, currentTheme, currentState, ...]);
```

## Storage to Yjs Relationship

```
Yjs doc.sourceClasses (Y.Map)
├── "src/Hero.astro:5:1" (Y.Map)
│   ├── classes: "p-4 md:pr-8 hover:bg-blue"  ← Serialized string
│   └── sourceLocation: { file, line, column }
└── "src/Card.astro:12:3" (Y.Map)
    ├── classes: "flex gap-4 dark:bg-gray-800"
    └── sourceLocation: { file, line, column }
```

The flow:
1. Yjs stores serialized class strings
2. DesignBar parses into ClassStorage for editing
3. Changes are serialized back and written to Yjs
4. ClassStore observer syncs to files

## Common Gotchas

### 1. Always use getClassesFromYjs() for rapid updates

```typescript
// BAD - React state can lag
const handleChange = (v) => {
  const storage = parseClasses(storeClasses);  // storeClasses might be stale!
  // ...
};

// GOOD - Read directly from Yjs
const handleChange = (v) => {
  const freshClasses = getClassesFromYjs(key);
  const storage = parseClasses(freshClasses);
  // ...
};
```

### 2. Property group conflicts

`text-base` and `text-blue-500` are in DIFFERENT groups:
- `text-base` → `standalone:textSize`
- `text-blue-500` → `text-`

They won't replace each other!

### 3. Cascade direction

Cascade goes SMALLER → LARGER breakpoints. You can't have `lg` override `md` if `md` comes after `lg` in the cascade.

### 4. Defaults have no prefix

`xs`, `light`, and `default` are implicit - no prefix in serialized string:
- `'p-4'` = xs.light.default
- `'hover:p-4'` = xs.light.hover
- `'md:p-4'` = md.light.default

## Example: Full Edit Cycle

```typescript
// Initial: "p-4 hover:bg-blue"
// User at md.light.default changes padding to p-8

// 1. Parse
storage = {
  xs: { light: { default: ['p-4'], hover: ['bg-blue'] } },
  md: { light: { default: [], hover: [] } },
  // ...
}

// 2. Get effective at md.light.default
effective = getEffectiveClasses(storage, 'md', 'light', 'default')
// Cascades: xs.light.default → md.light.default
// Result: ['p-4']

// 3. User wants: ['p-8']
newTokens = ['p-8']

// 4. computeSlotContent checks:
// - Inherited at md.light.default would be: ['p-4']
// - User wants: ['p-8']
// - Different! Store it.
slotContent = ['p-8']

// 5. Update storage
storage['md']['light']['default'] = ['p-8']

// 6. Serialize
serializeClasses(storage)
// "p-4 hover:bg-blue md:p-8"
// Note: xs.light.default still has 'p-4', md overrides to 'p-8'
```

## Debugging Tips

```typescript
// Log current storage
console.log('Storage:', JSON.stringify(storage, null, 2));

// Log cascade result
console.log('Effective:', getEffectiveClasses(storage, bp, theme, state));

// Log what computeSlotContent decides to store
console.log('Slot content:', computeSlotContent(storage, bp, theme, state, tokens));

// Log property groups
tokens.forEach(t => console.log(t, '→', getPropertyGroup(t)));
```
