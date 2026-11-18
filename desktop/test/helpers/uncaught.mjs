/** The exceptions nothing caught while `run` ran (and one turn after): in Electron main each was a modal dialog. */
export async function uncaughtDuring(run) {
  const seen = []; const record = error => seen.push(error);
  process.on('uncaughtException', record);
  try { await run(); await new Promise(r => setImmediate(r)); } finally { process.off('uncaughtException', record); }
  return seen;
}
