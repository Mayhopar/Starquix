/**
 * Bridge Constants
 *
 * Timing and threshold constants used by IFrameBridge.
 * Centralized here to avoid magic numbers and enable tuning.
 */

// Timing constants
export const SCAN_RETRY_BASE_MS = 200;
export const NAVIGATION_SETTLE_MS = 100;
export const DOUBLE_CLICK_THRESHOLD_MS = 300;
export const HOVER_THROTTLE_MS = 50;
export const SCAN_INITIAL_DELAY_MS = 100;
export const SCAN_MAX_RETRIES = 8;

// Distance thresholds
export const CLICK_MOVE_THRESHOLD_PX = 5;
export const DRAG_START_THRESHOLD_PX = 3;

