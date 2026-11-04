/**
 * @fileoverview The rows of the quick lint (tooling-136): it catches the rules that need no types, lets a type-only
 * error pass, names the repository plugin's finding, and says CI's full lint stays the gate.
 */

import {deepStrictEqual} from 'node:assert';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

/** The quick lint over the named files, the way the package script runs it. */
function lintQuick(files: string[]): Promise<{exit: number; output: string}> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['tools/lint-quick.ts', ...files], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
    }
    child.on('exit', exit => {
      resolve({exit: exit ?? 1, output});
    });
  });
}

/** The files a row makes under a throwaway folder of the repository, removed when the row ends. */
async function withFixtures(
  body: (scratch: string, tools: string) => Promise<void>,
): Promise<void> {
  const scratch = mkdtempSync(path.join(root, 'lint-quick-'));
  const tools = mkdtempSync(path.join(root, 'tools', 'lint-quick-'));
  try {
    await body(scratch, tools);
  } finally {
    rmSync(scratch, {recursive: true, force: true});
    rmSync(tools, {recursive: true, force: true});
  }
}

describe('the lint of the files a working tree changed (tooling-136)', () => {
  it('tooling-136: a short identifier is caught, and its rule is named', async () => {
    await withFixtures(async scratch => {
      const file = path.join(scratch, 'short.ts');
      writeFileSync(
        file,
        'function once() {\n  const a = 1;\n  return a;\n}\nonce();\n',
      );
      const result = await lintQuick([file]);
      deepStrictEqual(
        [result.exit, result.output.includes('id-length')],
        [1, true],
      );
    });
  });

  it('tooling-136: an error only the type-aware rules can see passes', async () => {
    await withFixtures(async scratch => {
      const file = path.join(scratch, 'type-only.ts');
      writeFileSync(
        file,
        'declare const clock: {tick(): void};\nconst handler = clock.tick;\nhandler();\n',
      );
      const result = await lintQuick([file]);
      deepStrictEqual(result.exit, 0);
    });
  });

  it('tooling-136: a repository plugin rule is caught, and its rule is named', async () => {
    await withFixtures(async (scratch, tools) => {
      const file = path.join(tools, 'surface.ts');
      writeFileSync(
        file,
        '// the spec requires the tick\nconst value = 1;\nconsole.log(value);\n',
      );
      const result = await lintQuick([file]);
      deepStrictEqual(
        [result.exit, result.output.includes('public-surface')],
        [1, true],
      );
    });
  });

  it('tooling-136: a clean file passes, and the full lint stays the gate', async () => {
    await withFixtures(async scratch => {
      const file = path.join(scratch, 'clean.ts');
      writeFileSync(file, 'const value = 1;\nconsole.log(value);\n');
      const result = await lintQuick([file]);
      deepStrictEqual(
        [
          result.exit,
          result.output.includes(
            "lint:quick: ok (type-aware rules not run; CI's lint is the gate)",
          ),
        ],
        [0, true],
      );
    });
  });
});
