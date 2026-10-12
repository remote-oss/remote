/**
 * @fileoverview The network rule of every client-side request (contracts section 5): no package makes a request of
 * its own or reads a proxy setting, so the editor's patched `fetch` and its proxy settings apply. The test reads the
 * source of every package and names the files that break the rule.
 */

import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const PACKAGES = path.join(import.meta.dirname, '..', '..', '..');

/** The modules a request or a proxy would come from. */
const FORBIDDEN_MODULES = [
  'http',
  'https',
  'undici',
  'http-proxy-agent',
  'https-proxy-agent',
  'proxy-agent',
];

/** The proxy settings and variables no module reads. */
const PROXY_NAMES = /http\.proxy|HTTP_PROXY|HTTPS_PROXY|NO_PROXY/;

/** The text of an import of `module`, in each of the four forms, with or without the `node:` prefix. */
function importFormsOf(moduleName: string): RegExp {
  const specifier = `['"\`](?:node:)?${moduleName.replaceAll('-', '\\-')}(?:/[^'"\`]*)?['"\`]`;
  return new RegExp(
    [
      `\\bimport\\s[^;]*?\\bfrom\\s*${specifier}`,
      `\\bimport\\s*${specifier}`,
      `\\bexport\\s[^;]*?\\bfrom\\s*${specifier}`,
      `\\bimport\\s*\\(\\s*${specifier}\\s*\\)`,
      `\\brequire\\s*\\(\\s*${specifier}\\s*\\)`,
    ].join('|'),
  );
}

const IMPORT_FORMS = FORBIDDEN_MODULES.map(importFormsOf);

/** Every file under `folder`, by walking its folders and listing its names one level at a time. */
function sourceFiles(folder: string): string[] {
  const names = readdirSync(folder, {withFileTypes: true});
  const folders = names.filter(entry => entry.isDirectory());
  const files = names.filter(entry => !entry.isDirectory());
  return [
    ...folders.flatMap(entry => sourceFiles(path.join(folder, entry.name))),
    ...files.map(entry => path.join(folder, entry.name)),
  ];
}

/** Whether the text breaks the rule. */
export function breaksNetworkRule(text: string): boolean {
  return PROXY_NAMES.test(text) || IMPORT_FORMS.some(form => form.test(text));
}

/** The `.ts` files under `packages/<package>/src`, for every package. */
function packageSources(): string[] {
  return readdirSync(PACKAGES, {withFileTypes: true})
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(PACKAGES, entry.name, 'src'))
    .flatMap(folder => {
      try {
        return sourceFiles(folder);
      } catch {
        // A package without a src folder has nothing to scan.
        return [];
      }
    })
    .filter(file => file.endsWith('.ts'));
}

const PLANTED = [
  "import https from 'node:https';",
  "import {request} from 'http';",
  "import * as agents from 'undici';",
  "export {HttpsProxyAgent} from 'https-proxy-agent';",
  "export * from 'node:http';",
  "const agent = await import('proxy-agent');",
  "const loaded = require('node:https');",
  "import 'http-proxy-agent';",
  "const proxy = process.env['HTTP_PROXY'];",
  'const noProxy = process.env.NO_PROXY;',
  "const setting = 'http.proxy';",
];

describe('the network rule of client-side requests (contracts section 5)', () => {
  it('no source file of any package imports a network module or names a proxy setting', () => {
    deepStrictEqual(
      packageSources().filter(file =>
        breaksNetworkRule(readFileSync(file, 'utf8')),
      ),
      [],
    );
  });

  for (const planted of PLANTED) {
    it(`a file with ${JSON.stringify(planted)} breaks the rule`, () => {
      deepStrictEqual(breaksNetworkRule(planted), true);
    });
  }

  it('a file that uses the global fetch and imports a module with a similar name keeps the rule', () => {
    deepStrictEqual(
      breaksNetworkRule(
        "import {httpStatus} from './http-status.ts';\nconst response = await fetch(address);",
      ),
      false,
    );
  });
});
