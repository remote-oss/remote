import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {FAILURE_TEMPLATES} from '../../src/surfaces/failure-strings.ts';
import {OWN_TEMPLATES} from '../../src/surfaces/own-strings.ts';
import {PROMPT_TEMPLATES} from '../../src/surfaces/prompt-strings.ts';

const PACKAGE = path.join(import.meta.dirname, '..', '..');
const SRC_DIR = path.join(PACKAGE, 'src');

/** The .ts files under `directory`, in directory order. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory()
      ? sourceFiles(path.join(directory, entry.name))
      : entry.name.endsWith('.ts')
        ? [path.join(directory, entry.name)]
        : [],
  );
}

/** Every string id the sources name as `id: 'S…'`, in order of appearance. */
function namedIds(): string[] {
  const named: string[] = [];
  for (const file of sourceFiles(SRC_DIR)) {
    for (const match of readFileSync(file, 'utf8').matchAll(
      /id: ['"](S\d{3})['"]/g,
    )) {
      named.push(match[1] ?? '');
    }
  }
  return named;
}

describe('the string ids the sources name', () => {
  it('contracts §3.2: every string id the remote-ssh sources name has a template', () => {
    const known = new Set([
      ...Object.keys(FAILURE_TEMPLATES),
      ...Object.keys(PROMPT_TEMPLATES),
      ...Object.keys(OWN_TEMPLATES),
    ]);
    deepStrictEqual(
      [...new Set(namedIds())].filter(stringId => !known.has(stringId)).sort(),
      [],
    );
  });
});
