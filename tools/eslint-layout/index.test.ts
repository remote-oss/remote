import path from 'node:path';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import plugin from './index.ts';

// The fixture workspace: extensions remote-a and remote-b; libraries lib-x and @fixture/lib-y, which declare each
// other (a cycle), and lib-z, which depends on lib-x without a cycle.
const root = path.join(import.meta.dirname, 'fixtures');
const file = (folder: string): string => path.join(root, 'packages', folder, 'src', 'index.ts');
const options = [{ root }];

new RuleTester({ languageOptions: { parser: tseslint.parser } }).run(
  'package-imports',
  plugin.rules['package-imports'],
  {
    valid: [
      { filename: file('remote-a'), code: "import { x } from 'lib-x';", options },
      { filename: file('remote-a'), code: "import { y } from './y.ts';", options },
      { filename: file('remote-a'), code: "import { y } from 'remote-a/y';", options },
      { filename: file('remote-a'), code: "import * as vscode from 'vscode';", options },
      { filename: file('lib-z'), code: "export { x } from 'lib-x';", options },
      { filename: path.join(root, 'outside.ts'), code: "import 'remote-a';", options },
    ],
    invalid: [
      {
        filename: file('remote-a'),
        code: "import { b } from 'remote-b';",
        options,
        errors: [{ messageId: 'extensionImportsExtension' }],
      },
      {
        filename: file('remote-a'),
        code: "const b = require('remote-b/sub');",
        options,
        errors: [{ messageId: 'extensionImportsExtension' }],
      },
      {
        filename: file('remote-a'),
        code: "const b = await import('remote-b');",
        options,
        errors: [{ messageId: 'extensionImportsExtension' }],
      },
      {
        filename: file('lib-x'),
        code: "export * from 'remote-a';",
        options,
        errors: [{ messageId: 'libraryImportsExtension' }],
      },
      {
        filename: file('lib-x'),
        code: "import { y } from '@fixture/lib-y';",
        options,
        errors: [
          {
            messageId: 'cycle',
            data: { from: 'lib-x', to: '@fixture/lib-y', chain: 'lib-x -> @fixture/lib-y -> lib-x' },
          },
        ],
      },
      {
        filename: file('remote-a'),
        code: "import { b } from '../../remote-b/src/index.ts';",
        options,
        errors: [{ messageId: 'relative' }, { messageId: 'extensionImportsExtension' }],
      },
      {
        filename: file('remote-a'),
        code: "import { x } from '../../lib-x/src/index.ts';",
        options,
        errors: [{ messageId: 'relative' }],
      },
    ],
  },
);
