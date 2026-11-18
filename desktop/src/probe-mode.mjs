// Env switch of the runtime probe (desktop/probe): SQ_PROBE_INVISIBLE=1 = an app that never activates, shows no window and never takes the
// keyboard, so a measuring run does not disturb whoever is working on the machine. Unset = main.mjs behaves exactly as without this file.
export const probeInvisible = env => env.SQ_PROBE_INVISIBLE === '1';
/** BrowserWindow options that keep the window hidden and unfocusable ({} when the switch is unset). */
export const probeWindowOptions = env => (probeInvisible(env) ? { show: false, opacity: 0, focusable: false } : {});
