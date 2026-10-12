/**
 * @fileoverview The lib-companion package skeleton: the manifest, configs, readme and entry module the package
 * ships with, read from the files themselves.
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';

const PACKAGE_ROOT = path.join(import.meta.dirname, '..', '..');
const REPOSITORY_ROOT = path.join(PACKAGE_ROOT, '..', '..');

/** A file of the package or the repository, by its path from the given root. */
function fileAt(root: string, relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('the lib-companion package skeleton', () => {
  it('F-5902.5.table: the manifest names the package, private, at 0.0.0', () => {
    const manifest = JSON.parse(fileAt(PACKAGE_ROOT, 'package.json')) as {
      name?: string;
      private?: boolean;
      version?: string;
    };
    deepStrictEqual(
      {
        name: manifest.name,
        private: manifest.private,
        version: manifest.version,
      },
      {name: 'lib-companion', private: true, version: '0.0.0'},
    );
  });

  it('F-5902.5.table: the manifest exports only the entry point', () => {
    const manifest = JSON.parse(fileAt(PACKAGE_ROOT, 'package.json')) as {
      exports?: unknown;
    };
    deepStrictEqual(manifest.exports, {
      '.': {types: './.tsc/src/index.d.ts', default: './src/index.ts'},
    });
  });

  it('F-5902.5.table: the manifest declares no dependencies', () => {
    const manifest = JSON.parse(fileAt(PACKAGE_ROOT, 'package.json')) as Record<
      string,
      unknown
    >;
    deepStrictEqual(
      ['dependencies' in manifest, 'devDependencies' in manifest],
      [false, false],
    );
  });

  it('F-5902.5.table: the coverage ratchet holds 100 for all three', () => {
    const coverage = JSON.parse(fileAt(PACKAGE_ROOT, 'coverage.json')) as {
      ratchet?: {lines?: number; branches?: number; functions?: number};
    };
    deepStrictEqual(coverage.ratchet, {
      lines: 100,
      branches: 100,
      functions: 100,
    });
  });

  it('F-5902.5.table: the config pair extends the family bases', () => {
    const build = JSON.parse(fileAt(PACKAGE_ROOT, 'tsconfig.json')) as {
      extends?: string;
      references?: unknown[];
    };
    const tests = JSON.parse(fileAt(PACKAGE_ROOT, 'tsconfig.test.json')) as {
      extends?: string;
      references?: Array<{path?: string}>;
    };
    deepStrictEqual(
      {
        buildExtends: build.extends,
        buildReferences: build.references,
        testExtends: tests.extends,
        testReferences: tests.references,
      },
      {
        buildExtends: '../../tsconfig.base.json',
        buildReferences: [],
        testExtends: '../../tsconfig.base.test.json',
        testReferences: [{path: './tsconfig.json'}],
      },
    );
  });

  it('F-5902.5.table: the root references hold both package paths', () => {
    const solution = JSON.parse(fileAt(REPOSITORY_ROOT, 'tsconfig.json')) as {
      references?: Array<{path?: string}>;
    };
    const paths = (solution.references ?? []).map(entry => entry.path);
    deepStrictEqual(
      {
        hasPackage: paths.includes('packages/lib-companion'),
        hasTests: paths.includes('packages/lib-companion/tsconfig.test.json'),
      },
      {hasPackage: true, hasTests: true},
    );
  });

  it('F-5902.5.table: the readme carries the package sentence and the heading', () => {
    const readme = fileAt(PACKAGE_ROOT, 'README.md');
    const unwrapped = readme.replace(/\s+/g, ' ');
    deepStrictEqual(
      {
        sentence: unwrapped.includes(
          'The plain-data messages that Remote Explorer and the extensions that serve it exchange: the version envelope, the payload shapes, and the rules that read them.',
        ),
        heading: unwrapped.includes('## For maintainers'),
      },
      {sentence: true, heading: true},
    );
  });

  it('F-5902.5.table: the readme carries no process wording or ids', () => {
    const readme = fileAt(PACKAGE_ROOT, 'README.md');
    deepStrictEqual(
      {
        featureIds: /F-\d{4}/.test(readme),
        cleanRoom: /clean.?room/i.test(readme),
        ruleIds: /\bR-\d+\b/.test(readme),
      },
      {featureIds: false, cleanRoom: false, ruleIds: false},
    );
  });
});
