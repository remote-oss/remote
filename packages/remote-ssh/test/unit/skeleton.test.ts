/**
 * @fileoverview The skeleton of the Remote - SSH package (card remote-ssh-00): the manifest fields, the nls
 * description in every locale, and the README's forbidden words.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

const PACKAGE = path.join(import.meta.dirname, '..', '..');
const DESCRIPTION =
  'Work on any machine you can reach over SSH as if the code were on your own disk.';

/** The manifest's shape, for the read the tests perform. */
interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  description?: string;
  license?: string;
  repository?: unknown;
  bugs?: unknown;
  keywords?: string[];
  main?: string;
  engines?: {vscode?: string};
  extensionKind?: string[];
  capabilities?: {untrustedWorkspaces?: {supported?: boolean}};
  activationEvents?: unknown[];
  extensionPack?: string[];
  dependencies?: Record<string, string>;
}

describe('skeleton (card remote-ssh-00 table)', () => {
  it('manifest fields: exactly the values of the skeleton card', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'),
    ) as Manifest;
    deepStrictEqual(manifest, {
      name: 'remote-ssh',
      version: '0.0.0',
      private: true,
      description: '%description%',
      license: 'MIT',
      repository: {
        type: 'git',
        ['url']: 'https://github.com/remote-oss/remote.git',
        directory: 'packages/remote-ssh',
      },
      bugs: {['url']: 'https://github.com/remote-oss/remote/issues'},
      keywords: ['remote development', 'remote', 'ssh'],
      main: './dist/extension.js',
      engines: {vscode: '^1.139.0'},
      extensionKind: ['ui'],
      capabilities: {untrustedWorkspaces: {supported: true}},
      activationEvents: [],
      extensionPack: [
        'remote-oss.remote-ssh-edit',
        'remote-oss.remote-explorer',
      ],
      dependencies: {
        'lib-identifiers': 'workspace:*',
        'lib-standdown': 'workspace:*',
        'lib-log': 'workspace:*',
        'lib-ssh': 'workspace:*',
      },
    });
  });

  it('every package.nls.*.json: 15 files, the one description key, the English text in each', () => {
    const files = readdirSync(PACKAGE).filter(file =>
      /^package\.nls(\..+)?\.json$/.test(file),
    );
    const tables = files.map(
      file =>
        JSON.parse(readFileSync(path.join(PACKAGE, file), 'utf8')) as {
          description: string;
        },
    );
    deepStrictEqual(
      {count: files.length, tables},
      {
        count: 15,
        tables: files.map(() => ({description: DESCRIPTION})),
      },
    );
  });

  it('README: none of the forbidden words', () => {
    const words = [
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
    const text = readFileSync(path.join(PACKAGE, 'README.md'), 'utf8');
    deepStrictEqual(
      words.filter(word =>
        new RegExp(word.includes('-') ? word : `\\b${word}\\b`, 'i').test(text),
      ),
      [],
    );
  });
});
