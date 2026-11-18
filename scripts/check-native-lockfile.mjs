import { readFileSync } from 'node:fs';
import path from 'node:path';

// npm can prune other platforms' optional binaries when updating a lockfile
// with an existing node_modules tree. A macOS install then passes while Linux
// CI cannot load Lightning CSS or Tailwind Oxide. Check every published variant.
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const packages = lock.packages;
const failures = [];
let checked = 0;
for (const [owner, entry] of Object.entries(packages)) {
  if (!/(?:^|\/)node_modules\/(?:lightningcss|@tailwindcss\/oxide)$/.test(owner)) continue;
  for (const [name, version] of Object.entries(entry.optionalDependencies ?? {})) {
    let directory = owner;
    let resolved;
    while (true) {
      resolved = packages[path.posix.join(directory, 'node_modules', name)];
      if (resolved || directory === '.') break;
      directory = path.posix.dirname(directory);
    }
    checked++;
    if (!resolved || resolved.version !== version || !resolved.integrity) {
      failures.push(`${owner}: missing locked ${name}@${version} with integrity`);
    }
  }
}
if (checked === 0) failures.push('No native dependency variants found in package-lock.json');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Native lockfile: ${checked} platform variants verified`);
}
