/**
 * Project ids the legacy test corpus spelled `local_<x>` to mean "on the local
 * runtime". The host-folder disk is gone (2026-09-10) and the runtime has ONE
 * disk, so those ids are `browser_lf_<x>` files-truth projects now; the vitest
 * setup marks them files-truth before every test so `isLocalProjectId` reads
 * true for them. Any other `browser_…` id stays a plain (unresolved) project —
 * the distinct prefix keeps the "non-local project" pins meaningful.
 */
export const FILES_TRUTH_TEST_IDS = [
  'browser_lf_a',
  'browser_lf_abc',
  'browser_lf_abc123',
  'browser_lf_failed',
  'browser_lf_folder',
  'browser_lf_keyboard',
  'browser_lf_keyboard_participants_',
  'browser_lf_media_replay_failure',
  'browser_lf_myfolder',
  'browser_lf_other',
  'browser_lf_p',
  'browser_lf_p1',
  'browser_lf_ready',
  'browser_lf_release',
  'browser_lf_seedhome',
  'browser_lf_src',
  'browser_lf_test',
  'browser_lf_test-project',
  'browser_lf_testsite',
  'browser_lf_x',
] as const;
