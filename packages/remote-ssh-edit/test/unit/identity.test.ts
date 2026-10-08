/**
 * @fileoverview The identity card of the package: the manifest fields, the nls description in every locale, and the
 * README's sections.
 */

import {deepStrictEqual, ok} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');
const DESCRIPTION =
  'Highlighting and completion for SSH config files, with every keyword documented as you type.';

/** The identity values the card fixes. */
const EXPECTED = {
  displayName: 'Remote - SSH: Editing Configuration Files',
  description: '%description%',
  keywords: ['remote development', 'remote', 'ssh', 'ssh config'],
  repository: {
    type: 'git',
    ['url']: 'https://github.com/remote-oss/remote.git',
    directory: 'packages/remote-ssh-edit',
  },
  bugs: {['url']: 'https://github.com/remote-oss/remote/issues'},
  homepage: undefined,
  license: 'MIT',
  icon: undefined,
};

/** The manifest fields the card names, read from the package. */
function manifest(): typeof EXPECTED {
  return JSON.parse(
    readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'),
  ) as typeof EXPECTED;
}

/** Every package.nls file (the base and each locale), keyed by file name. */
function nlsTables(): Map<string, Record<string, string>> {
  const tables = new Map<string, Record<string, string>>();
  for (const file of readdirSync(PACKAGE)) {
    if (/^package\.nls(\..+)?\.json$/.test(file)) {
      tables.set(
        file,
        JSON.parse(readFileSync(path.join(PACKAGE, file), 'utf8')) as Record<
          string,
          string
        >,
      );
    }
  }
  return tables;
}

/** The section headings of the README, in document order. */
function readmeHeadings(): string[] {
  const text = readFileSync(path.join(PACKAGE, 'README.md'), 'utf8');
  return text
    .split('\n')
    .filter(line => line.startsWith('## '))
    .map(line => line.slice(3).trim());
}

/** The forbidden words the README must not use (the card's list), each matched as a word. */
const FORBIDDEN = [
  'reference',
  'Microsoft',
  'ms-vscode',
  'clean-room',
  'reimplement',
  'spec',
  'session',
  'worker',
  'lab',
];

function forbiddenFound(): string[] {
  const text = readFileSync(path.join(PACKAGE, 'README.md'), 'utf8');
  return FORBIDDEN.filter(word =>
    word.includes('-')
      ? new RegExp(word, 'i').test(text)
      : new RegExp(`\\b${word}\\b`, 'i').test(text),
  );
}

describe('identity card (card identity-01 table)', () => {
  it('package.json fields: exactly the values of the identity card', () => {
    const read = manifest();
    deepStrictEqual(
      {
        displayName: read.displayName,
        description: read.description,
        keywords: read.keywords,
        repository: read.repository,
        bugs: read.bugs,
        homepage: read.homepage,
        license: read.license,
        icon: read.icon,
      },
      EXPECTED,
    );
  });

  it('every package.nls.*.json: the description is the English text and the keys match across locales', () => {
    const tables = nlsTables();
    const base = tables.get('package.nls.json');
    ok(base !== undefined);
    const baseKeys = Object.keys(base).sort();
    const observed = [...tables.entries()].map(([file, table]) => ({
      file,
      keys: Object.keys(table).sort(),
      description: table.description,
    }));
    deepStrictEqual(
      observed,
      observed.map(entry => ({
        file: entry.file,
        keys: baseKeys,
        description: DESCRIPTION,
      })),
    );
  });

  it('README: the seven section headings in order and none of the forbidden words', () => {
    deepStrictEqual(
      {headings: readmeHeadings().slice(0, 7), forbidden: forbiddenFound()},
      {
        headings: [
          'What you get',
          'Get started',
          'Requirements',
          'Settings and commands',
          'Part of remote-oss',
          'Support',
          'License',
        ],
        forbidden: [],
      },
    );
  });
});
