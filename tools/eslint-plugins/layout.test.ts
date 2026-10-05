import path from 'node:path';
import {RuleTester} from 'eslint';
import tseslint from 'typescript-eslint';
import {layoutPlugin as plugin} from './layout.ts';

// The fixture workspace: extensions remote-a and remote-b; libraries lib-x and @fixture/lib-y, which declare each
// other (a cycle), and lib-z, which depends on lib-x without a cycle.
const root = path.join(import.meta.dirname, 'fixtures');
function file(folder: string): string {
  return path.join(root, 'packages', folder, 'src', 'index.ts');
}
const options = [{root}];

new RuleTester({languageOptions: {parser: tseslint.parser}}).run(
  'package-imports',
  plugin.rules['package-imports'],
  {
    valid: [
      {filename: file('remote-a'), code: "import { x } from 'lib-x';", options},
      {
        filename: file('remote-a'),
        code: "import { y } from './y.ts';",
        options,
      },
      {
        filename: file('remote-a'),
        code: "import { y } from 'remote-a/y';",
        options,
      },
      {
        filename: file('remote-a'),
        code: "import * as vscode from 'vscode';",
        options,
      },
      {filename: file('lib-z'), code: "export { x } from 'lib-x';", options},
      {
        filename: path.join(root, 'outside.ts'),
        code: "import 'remote-a';",
        options,
      },
      {
        filename: file('remote-a'),
        code: 'const x = await import(`lib-x`);',
        options,
      },
      {
        filename: file('remote-a'),
        code: "type X = import('lib-x').X;",
        options,
      },
      {
        filename: file('remote-a'),
        code: "import x = require('lib-x');",
        options,
      },
      {filename: file('remote-a'), code: "declare module 'vscode' {}", options},
    ],
    invalid: [
      {
        filename: file('remote-a'),
        code: "import { b } from 'remote-b';",
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('remote-a'),
        code: "const b = require('remote-b/sub');",
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('remote-a'),
        code: "const b = await import('remote-b');",
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('lib-x'),
        code: "export * from 'remote-a';",
        options,
        errors: [{messageId: 'libraryImportsExtension'}],
      },
      {
        filename: file('lib-x'),
        code: "import { y } from '@fixture/lib-y';",
        options,
        errors: [
          {
            messageId: 'cycle',
            data: {
              importer: 'lib-x',
              imported: '@fixture/lib-y',
              chain: 'lib-x -> @fixture/lib-y -> lib-x',
            },
          },
        ],
      },
      {
        filename: file('remote-a'),
        code: "import { b } from '../../remote-b/src/index.ts';",
        options,
        errors: [
          {messageId: 'relative'},
          {messageId: 'extensionImportsExtension'},
        ],
      },
      {
        filename: file('remote-a'),
        code: "import { x } from '../../lib-x/src/index.ts';",
        options,
        errors: [{messageId: 'relative'}],
      },
      {
        filename: file('remote-a'),
        code: "import { b } from '../../remote-b';",
        options,
        errors: [
          {messageId: 'relative'},
          {messageId: 'extensionImportsExtension'},
        ],
      },
      {
        filename: file('remote-a'),
        code: "import { b } from '../../remote-b/';",
        options,
        errors: [
          {messageId: 'relative'},
          {messageId: 'extensionImportsExtension'},
        ],
      },
      {
        filename: file('remote-a'),
        code: 'const b = await import(`remote-b`);',
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('remote-a'),
        code: 'const b = require(`remote-b`);',
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('remote-a'),
        code: "export type B = import('remote-b').B;",
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('remote-a'),
        code: "type B = typeof import('../../remote-b/src/index.ts');",
        options,
        errors: [
          {messageId: 'relative'},
          {messageId: 'extensionImportsExtension'},
        ],
      },
      {
        filename: file('remote-a'),
        code: "import b = require('remote-b');",
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('remote-a'),
        code: "declare module 'remote-b' {}",
        options,
        errors: [{messageId: 'extensionImportsExtension'}],
      },
      {
        filename: file('remote-a'),
        code: "const name = 'remote-b'; const b = await import(name);",
        options,
        errors: [{messageId: 'computed'}],
      },
      {
        filename: file('remote-a'),
        code: "const b = require(`remote-${'b'}`);",
        options,
        errors: [{messageId: 'computed'}],
      },
    ],
  },
);
