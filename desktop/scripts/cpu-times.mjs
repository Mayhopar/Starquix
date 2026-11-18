// CPU time per process of the profiled app (scripts/profile.mjs, per step): under machine load wall times
// swing, CPU time holds. Labels: main, editor/preview (the renderers of the windows' frames), gpu, astro
// (a runner + its children), tracing (the tracer's own cost), other helpers by --type, 'other' for any
// other child of main. ps time has 10 ms resolution.
const secs = t => t.split(':').reduce((a, x) => a * 60 + Number(x), 0); // ps time = [h:]m:ss.cc

/** pid → { k: label, s: CPU seconds } for main and its descendants.
 *  ps = `ps -axo pid=,ppid=,time=,command=`; frames = [[osProcessId, url]], each window's main frame first. */
export function cpuTimes(ps, mainPid, frames) {
  const label = new Map(); // a renderer shared with the editor stays 'editor'
  for (const [pid, url] of frames) if (!label.has(pid)) label.set(pid, /^http:\/\/127\.0\.0\.1:(?!3061)/.test(url) ? 'preview' : 'editor');
  const rows = new Map(ps.split('\n').map(l => l.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, t, cmd]) => [+pid, { ppid: +ppid, s: secs(t), cmd }]));
  const kinds = new Map([[mainPid, 'main']]);
  const kind = pid => { // null = not the app's; own rule first, else the parent's (esbuild under a runner = astro)
    if (kinds.has(pid)) return kinds.get(pid);
    const r = rows.get(pid); kinds.set(pid, null); // a ppid cycle ends here
    const up = r && r.ppid > 1 ? kind(r.ppid) : null;
    const k = up && (label.get(pid) ?? (/runner\.mjs/.test(r.cmd) ? 'astro' : /tracing\.mojom/i.test(r.cmd) ? 'tracing'
      : /--type=gpu-process/.test(r.cmd) ? 'gpu' : /--type=(\w+)/.exec(r.cmd)?.[1] ?? (up === 'main' ? 'other' : up)));
    kinds.set(pid, k); return k;
  };
  return new Map([...rows].flatMap(([pid, r]) => { const k = kind(pid); return k ? [[pid, { k, s: r.s }]] : []; }));
}

/** CPU ms per label from sample a to sample b.
 *  ponytail: a process that exits between them loses its CPU (no end sample); one born between them counts in full. */
export function cpuDelta(a, b) {
  const ms = {};
  for (const [pid, { k, s }] of b) ms[k] = (ms[k] ?? 0) + Math.round((s - (a.get(pid)?.s ?? 0)) * 1000);
  return ms;
}
