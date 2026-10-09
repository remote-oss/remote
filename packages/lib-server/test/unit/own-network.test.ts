import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const SOURCE_FOLDER = path.join(import.meta.dirname, '..', '..', 'src');

/** Text that only code making its own request or reading a proxy setting contains. */
const OWN_NETWORK = [
  /node:https?/,
  /\bfetch\(/,
  /XMLHttpRequest/,
  /\bAgent\b/,
  /[Pp]roxyAgent/,
  /process\.env/,
];

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory()
      ? sourceFiles(path.join(folder, entry.name))
      : [path.join(folder, entry.name)],
  );
}

describe('client-side network access (contracts section 5, network rule)', () => {
  it('no module of the library makes a request of its own or reads a proxy setting', () => {
    const offenders = sourceFiles(SOURCE_FOLDER).filter(file => {
      const text = readFileSync(file, 'utf8');
      return OWN_NETWORK.some(pattern => pattern.test(text));
    });
    deepStrictEqual(offenders, []);
  });
});
