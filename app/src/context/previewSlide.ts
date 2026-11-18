/**
 * Preview chrome-slide transition (task-116). Shared by the three panels that
 * slide when preview toggles — LeftSidebar, DesignBar, and the canvas top bar —
 * so their timing and the motion-reduce affordance can't drift apart. Only the
 * translate direction + z-index differ per site. (The footer's collapse is a
 * different effect and intentionally not folded in here.)
 *
 * Deliberately its own module, NOT an `@/context` barrel export: 13 test files
 * mock the barrel with literal objects, and any that render a slide consumer
 * would then have to add this export. Import it by direct path to sidestep the
 * mock entirely.
 */
export const PREVIEW_SLIDE_TRANSITION =
  'transition-transform duration-300 ease-in-out motion-reduce:transition-none';
