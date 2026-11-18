// First boot dies before readiness (a crash, not a config error); later boots run the real runner.
import fs from 'node:fs';
fs.appendFileSync('.sq/configs.log', process.env.SQ_DESKTOP_CONFIG + '\n');
if (fs.readFileSync('.sq/configs.log', 'utf8').trim().split('\n').length === 1) process.exit(1);
await import('../../src/runner.mjs');
