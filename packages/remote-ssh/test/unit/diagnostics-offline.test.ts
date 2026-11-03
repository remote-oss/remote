import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGES = path.join(import.meta.dirname, '..', '..', '..');

/** The source folders of the session hints and their store, and the file of the terminal's editor adapter: nothing in them may reach a network. */
const FOLDERS = [
  path.join(PACKAGES, 'lib-ssh', 'src', 'diagnostics'),
  path.join(PACKAGES, 'remote-ssh', 'src', 'diagnostics'),
];
const FILES = [
  path.join(PACKAGES, 'remote-ssh', 'src', 'troubleshooting-editor.ts'),
];

/** A way to reach a network: an import of a Node network module, or a call of `fetch`. */
const NETWORK = /from 'node:(?:http2?|https|net|tls|dgram|dns)'|\bfetch\(/u;

/** The files of `folder` whose text reaches a network. */
function networkUsers(folder: string): string[] {
  return readdirSync(folder)
    .filter(file => file.endsWith('.ts'))
    .filter(file => NETWORK.test(readFileSync(path.join(folder, file), 'utf8')))
    .map(file => path.join(path.basename(path.dirname(folder)), file));
}

describe('the session hints send nothing online (F-2605)', () => {
  it('F-2605.AC-27: no source of the hints, their store or their terminal and its editor adapter imports a network module or calls fetch', () => {
    deepStrictEqual(
      [
        ...FOLDERS.flatMap(networkUsers),
        ...FILES.filter(file => NETWORK.test(readFileSync(file, 'utf8'))),
      ],
      [],
    );
  });

  it('F-2605.AC-27: the scan finds a network import and a fetch call, so it cannot pass by matching nothing', () => {
    deepStrictEqual(
      [
        "import {request} from 'node:https';",
        'await fetch(address);',
        "import {readFileSync} from 'node:fs';",
      ].map(text => NETWORK.test(text)),
      [true, true, false],
    );
  });
});
