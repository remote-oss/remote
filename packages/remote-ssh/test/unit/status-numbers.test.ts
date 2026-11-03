import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {STATUS_NUMBERS} from 'lib-ssh';

const PACKAGES = path.join(import.meta.dirname, '..', '..', '..');

/** The `.ts` files under `folder`, without the tests. */
function sourcesUnder(folder: string): string[] {
  return readdirSync(folder, {recursive: true, encoding: 'utf8'})
    .filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map(file => path.join(folder, file));
}

/** The status names the source of `folder` gives to a hint: `status: 'Name'` and the second argument of `withHint`. */
function statusesIn(folder: string): string[] {
  return sourcesUnder(folder).flatMap(file => {
    const text = readFileSync(file, 'utf8');
    return [
      ...text.matchAll(/\bstatus: '([A-Z][A-Za-z]+)'/gu),
      ...text.matchAll(/\bwithHint\(\s*[^,]+,\s*'([A-Z][A-Za-z]+)'/gu),
    ].flatMap(found => (found[1] === undefined ? [] : [found[1]]));
  });
}

describe('the numbers of the error statuses cover every status a hint can carry (card connect-135)', () => {
  it('F-2605: each status lib-ssh and remote-ssh give a hint has a number, so a new one cannot ship without its appended number', () => {
    const statuses = [
      ...new Set([
        ...statusesIn(path.join(PACKAGES, 'lib-ssh', 'src')),
        ...statusesIn(path.join(PACKAGES, 'remote-ssh', 'src')),
      ]),
    ].sort();
    deepStrictEqual(
      statuses.filter(status => !Object.hasOwn(STATUS_NUMBERS, status)),
      [],
    );
  });

  it('F-2605: the scan finds the statuses of the table, so it cannot pass by finding none', () => {
    const statuses = new Set([
      ...statusesIn(path.join(PACKAGES, 'lib-ssh', 'src')),
      ...statusesIn(path.join(PACKAGES, 'remote-ssh', 'src')),
    ]);
    deepStrictEqual(
      Object.keys(STATUS_NUMBERS)
        .filter(status => !statuses.has(status))
        .sort(),
      [],
    );
  });
});
