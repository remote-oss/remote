import path from 'node:path';
import {RuleTester} from 'eslint';
import tseslint from 'typescript-eslint';
import {layoutPlugin as plugin} from './layout.ts';
import {TemporaryWorkspace} from '../temporary-workspace.ts';

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

// The card tooling-05 table, in a temporary workspace that lives for the whole run: the files are written when
// this module loads, so they exist by the time the table's tests run; the edit test runs after the table, so the
// table has filled the rule's cache first; the root-suite after hook removes the workspace last.
const intraWorkspace = new TemporaryWorkspace('intra-cycles');

function intraFile(folder: string, name: string): string {
  return path.join(intraWorkspace.root, 'packages', folder, name);
}

function writeIntraPackage(
  folder: string,
  files: Record<string, string>,
): void {
  for (const [name, content] of Object.entries(files)) {
    intraWorkspace.write(`packages/${folder}/${name}`, content);
  }
}

const intraOptions = [{root: intraWorkspace.root}];

const twoCycle = {
  'a.ts': "import {b} from './b.ts';\nexport const a = b;\n",
  'b.ts': "import {a} from './a.ts';\nexport const b = a + 1;\n",
};
const threeCycle = {
  'c.ts': "import {d} from './d.ts';\nexport const c = d;\n",
  'd.ts': "import {e} from './e.ts';\nexport const d = e;\n",
  'e.ts': "import {c} from './c.ts';\nexport const e = c;\n",
};
const typeCycle = {
  't1.ts': "import type {T2} from './t2.ts';\nexport const t1: T2 = 'one';\n",
  't2.ts':
    "import {t1} from './t1.ts';\nexport type T2 = string;\nexport const t2 = t1;\n",
};
const starCycle = {
  's1.ts': "export * from './s2.ts';\nexport const s1 = 'one';\n",
  's2.ts': "export * from './s1.ts';\nexport const s2 = 'two';\n",
};
const dynamicCycle = {
  'v1.ts': "export const v1 = 'one';\nvoid import('./v2.ts');\n",
  'v2.ts': "import {v1} from './v1.ts';\nexport const v2 = v1;\n",
};
const testOnlyCycle = {
  'src/plain.ts': "export const plain = 'ok';\n",
  'test/ta.ts': "import {tb} from './tb.ts';\nexport const ta = tb;\n",
  'test/tb.ts': "import {ta} from './ta.ts';\nexport const tb = ta + 1;\n",
};
// Every way the rule must read a specifier, in a package without a cycle: the line and block comments hide
// specifiers, the bare and the unresolvable ones resolve nowhere, and the computed and member ones are not
// literals; the three unterminated files never parse, so the rule only ever reads them.
const mixed = {
  'src/mix1.ts':
    "// a line comment import {nope} from './missing1.ts'\n" +
    "/* a block comment import {nope} from './missing2.ts' */\n" +
    'import {doubleQuoted} from "./mix2.ts";\n' +
    "import * as stars from 'vscode';\n" +
    "import './missing3.ts';\n" +
    "const dynamic = import('./mix2.ts');\n" +
    'const computed = import(specifier);\n' +
    "const member = object.import('./mix2.ts');\n" +
    'const template = import(`./mix2.ts`);\n' +
    "const computedTemplate = import(`./${'mix2'}.ts`);\n" +
    'export const mix1 = ' +
    'doubleQuoted + stars + dynamic + member + template + computedTemplate;\n',
  'src/mix2.ts':
    "import {reexported} from './mix3.ts';\n" +
    "export {reexported} from './mix3.ts';\n" +
    'export const mix2 = reexported;\n',
  'src/mix3.ts':
    "export const reexported = 'three';\n" +
    'export const from = 7;\n' +
    'const myfrom = 1;\n' +
    'export const nested = `a ${`b`} c`;\n' +
    "export const escaped = 'a \\'b c';\n" +
    'export const mix3 = from + myfrom + nested + escaped;\n',
  'src/mix-unterminated.ts':
    '/* a comment that never closes\nexport const broken = 1;\n',
  'src/mix-unterminated-string.ts':
    "export const broken = 'a string that never closes\n",
  'src/mix-unterminated-template.ts':
    'export const broken = `a template that never closes\n',
};
function chainFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let index = 1; index <= 10; index += 1) {
    const name = `m${String(index)}.ts`;
    const importLine =
      index < 10
        ? `import {m${String(index + 1)}} from './m${String(index + 1)}.ts';\n`
        : '';
    files[`src/${name}`] =
      `${importLine}export const m${String(index)} = ${String(index)};\n`;
  }
  return files;
}
const chain = chainFiles();

writeIntraPackage('lib-two', {
  'src/a.ts': twoCycle['a.ts'],
  'src/b.ts': twoCycle['b.ts'],
});
writeIntraPackage('lib-three', {
  'src/c.ts': threeCycle['c.ts'],
  'src/d.ts': threeCycle['d.ts'],
  'src/e.ts': threeCycle['e.ts'],
});
writeIntraPackage('lib-type', {
  'src/t1.ts': typeCycle['t1.ts'],
  'src/t2.ts': typeCycle['t2.ts'],
});
writeIntraPackage('lib-star', {
  'src/s1.ts': starCycle['s1.ts'],
  'src/s2.ts': starCycle['s2.ts'],
});
writeIntraPackage('lib-dynamic', {
  'src/v1.ts': dynamicCycle['v1.ts'],
  'src/v2.ts': dynamicCycle['v2.ts'],
});
writeIntraPackage('lib-tests-only', testOnlyCycle);
writeIntraPackage('lib-dag', chain);
writeIntraPackage('lib-mixed', mixed);

new RuleTester({languageOptions: {parser: tseslint.parser}}).run(
  'no-intra-package-cycles',
  plugin.rules['no-intra-package-cycles'],
  {
    valid: [
      // The cycle is reported once, from its first file; the other member of the same cycle is clean.
      {
        filename: intraFile('lib-two', 'src/b.ts'),
        code: twoCycle['b.ts'],
        options: intraOptions,
      },
      // A ten-file chain without a cycle reports nothing, at every file.
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(index => ({
        filename: intraFile('lib-dag', `src/m${String(index)}.ts`),
        code: chain[`src/m${String(index)}.ts`],
        options: intraOptions,
      })),
      // A cycle that lives only in test/ is out of scope, in and out of src/.
      {
        filename: intraFile('lib-tests-only', 'src/plain.ts'),
        code: testOnlyCycle['src/plain.ts'],
        options: intraOptions,
      },
      {
        filename: intraFile('lib-tests-only', 'test/ta.ts'),
        code: testOnlyCycle['test/ta.ts'],
        options: intraOptions,
      },
      {
        filename: intraFile('lib-tests-only', 'test/tb.ts'),
        code: testOnlyCycle['test/tb.ts'],
        options: intraOptions,
      },
      // The package that reads every specifier form, without a cycle.
      {
        filename: intraFile('lib-mixed', 'src/mix1.ts'),
        code: mixed['src/mix1.ts'],
        options: intraOptions,
      },
      {
        filename: intraFile('lib-mixed', 'src/mix2.ts'),
        code: mixed['src/mix2.ts'],
        options: intraOptions,
      },
      {
        filename: intraFile('lib-mixed', 'src/mix3.ts'),
        code: mixed['src/mix3.ts'],
        options: intraOptions,
      },
    ],
    invalid: [
      {
        filename: intraFile('lib-two', 'src/a.ts'),
        code: twoCycle['a.ts'],
        options: intraOptions,
        errors: [{messageId: 'cycle', data: {chain: 'a.ts → b.ts → a.ts'}}],
      },
      {
        filename: intraFile('lib-three', 'src/c.ts'),
        code: threeCycle['c.ts'],
        options: intraOptions,
        errors: [
          {messageId: 'cycle', data: {chain: 'c.ts → d.ts → e.ts → c.ts'}},
        ],
      },
      {
        filename: intraFile('lib-type', 'src/t1.ts'),
        code: typeCycle['t1.ts'],
        options: intraOptions,
        errors: [{messageId: 'cycle', data: {chain: 't1.ts → t2.ts → t1.ts'}}],
      },
      {
        filename: intraFile('lib-star', 'src/s1.ts'),
        code: starCycle['s1.ts'],
        options: intraOptions,
        errors: [{messageId: 'cycle', data: {chain: 's1.ts → s2.ts → s1.ts'}}],
      },
      {
        filename: intraFile('lib-dynamic', 'src/v1.ts'),
        code: dynamicCycle['v1.ts'],
        options: intraOptions,
        errors: [{messageId: 'cycle', data: {chain: 'v1.ts → v2.ts → v1.ts'}}],
      },
    ],
  },
);

// Runs after the table: by then the table has filled the cache, and the edit must make the rule re-read.
it('no-intra-package-cycles: a file edit is seen through the cache (card tooling-05)', () => {
  intraWorkspace.write(
    'packages/lib-two/src/b.ts',
    "import {a} from './a.ts';\nexport const b = a;\n",
  );
  new RuleTester({languageOptions: {parser: tseslint.parser}}).run(
    'no-intra-package-cycles',
    plugin.rules['no-intra-package-cycles'],
    {
      valid: [],
      invalid: [
        {
          filename: intraFile('lib-two', 'src/a.ts'),
          code: twoCycle['a.ts'],
          options: intraOptions,
          errors: [{messageId: 'cycle', data: {chain: 'a.ts → b.ts → a.ts'}}],
        },
      ],
    },
  );
});

after(() => {
  intraWorkspace.remove();
});
