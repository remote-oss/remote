import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {localChannel} from 'lib-host';
import {parseResult} from '../../src/index.ts';

const POSIX_GOLDENS = path.join(import.meta.dirname, 'golden', 'posix');

/**
 * The goldens rendered with the base parameters, whose paths are all relative to the home folder: the `full-` ones
 * name absolute folders and a process to stop, which no run of ours may touch.
 */
const BASE_GOLDENS = readdirSync(POSIX_GOLDENS).filter(file =>
  file.startsWith('base-'),
);

describe('the POSIX goldens run on the local shell (card #3158)', function () {
  this.timeout(120000);
  let home = '';
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'lib-server-local-golden-'));
  });
  afterEach(() => {
    rmSync(home, {recursive: true, force: true});
  });

  for (const file of BASE_GOLDENS) {
    it(`${file}: runs to its end under the local sh in an empty home, and what it printed has a result block`, async () => {
      const lines: string[] = [];
      const outcome = await localChannel({
        identity: 'this-machine',
        platform: 'linux',
      }).runScript(
        {
          script: readFileSync(path.join(POSIX_GOLDENS, file), 'utf8'),
          interpreter: 'posixShell',
          environment: {HOME: home},
          input: {kind: 'text', text: ''},
          cancellation: new AbortController().signal,
        },
        line => {
          lines.push(line);
        },
      );
      const parsed = parseResult(lines);
      deepStrictEqual(
        [outcome.kind, 'block' in parsed],
        ['exited', true],
        `${file} printed ${JSON.stringify(lines.slice(-6))}`,
      );
    });
  }
});
