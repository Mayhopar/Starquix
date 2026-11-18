// A check child that found 101 errors (more than main passes on).
const errors = Array.from({ length: 101 }, (_, i) => ({ file: 'src/pages/index.astro', line: i + 1, column: 5, code: 'ts(2339)', message: `error ${i}` }));
process.send({ type: 'checked', errors }, () => process.exit(0));
