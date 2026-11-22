import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const SOURCES = path.join(import.meta.dirname, '..', '..', 'src');

/** The source files below `folder`, as paths. */
function filesBelow(folder: string): string[] {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory()
      ? filesBelow(path.join(folder, entry.name))
      : [path.join(folder, entry.name)],
  );
}

describe('the strings the spec leaves unused (card #2854)', () => {
  it('F-2402 AC-14: STR:S020, "Checking VS Code Server status failed", is used nowhere in the sources', () => {
    deepStrictEqual(
      filesBelow(SOURCES).filter(file => {
        const text = readFileSync(file, 'utf8');
        return (
          /\bS020\b/u.test(text) ||
          text.includes('Checking VS Code Server status failed')
        );
      }),
      [],
    );
  });
});
