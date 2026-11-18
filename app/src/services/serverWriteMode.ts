// task-108 §7: writers are armed per-project-mode, set once by Editor at mount.
// Kills the OQ3 coupling: a running :4321 no longer arms writes for WC projects.
let enabled = false;
export function setServerWriteMode(v: boolean): void {
  enabled = v;
}
export function isServerWriteMode(): boolean {
  return enabled;
}
