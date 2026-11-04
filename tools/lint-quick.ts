/**
 * @fileoverview The lint of the files a working tree changed: ESLint over the named files, the type-aware rules off
 * (eslint.quick.config.ts), in a heap small enough for a machine with little memory. CI's full lint stays the gate.
 */

import {spawn} from 'node:child_process';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: pnpm lint:quick <file…>');
  process.exit(2);
}

const child = spawn(
  process.execPath,
  [
    '--max-old-space-size=1024',
    'node_modules/eslint/bin/eslint.js',
    '--config',
    'eslint.quick.config.ts',
    ...files,
  ],
  {stdio: 'inherit'},
);

child.on('exit', (exit, signal) => {
  if (signal !== null) {
    process.exit(1);
  }
  if (exit === 0) {
    console.log(
      "lint:quick: ok (type-aware rules not run; CI's lint is the gate)",
    );
  }
  process.exit(exit ?? 1);
});
