import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {build, type BuildResult} from 'esbuild';

const PACKAGE = path.join(import.meta.dirname, '..', '..');

const PROGRAMS = ['connection-helper', 'askpass'];

/** Bundles a program the way the build does, in memory. */
function bundleOf(
  program: string,
): Promise<BuildResult<{write: false; metafile: true}>> {
  return build({
    entryPoints: [path.join(PACKAGE, 'src', 'programs', `${program}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
}

describe('the bundled programs (connect-00)', () => {
  for (const program of PROGRAMS) {
    it(`${program}: bundles on its own without the editor, which would not resolve`, async () => {
      deepStrictEqual((await bundleOf(program)).errors, []);
    });

    it(`${program}: its bundle never loads the vscode module`, async () => {
      const text = (await bundleOf(program)).outputFiles
        .map(file => file.text)
        .join('\n');
      deepStrictEqual(/require\(["']vscode["']\)/.test(text), false);
    });

    it(`${program}: none of its inputs is the vscode module`, async () => {
      const inputs = Object.keys((await bundleOf(program)).metafile.inputs);
      deepStrictEqual(
        inputs.filter(input => /(^|\/)vscode(\/|$)/.test(input)),
        [],
      );
    });

    it(`${program}: the extension ships its bundle`, () => {
      const lines = readFileSync(
        path.join(PACKAGE, '.vscodeignore'),
        'utf8',
      ).split('\n');
      deepStrictEqual(lines.includes(`!dist/${program}.js`), true);
    });
  }
});
