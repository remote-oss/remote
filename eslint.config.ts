/**
 * @fileoverview ESLint configuration: the Google TypeScript style guide as ADR-0003 enforces it, and the import
 * rules of docs/architecture/layout.md.
 */

import eslintJs from '@eslint/js';
import {defineConfig} from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import {commentsPlugin} from './tools/eslint-plugins/comments.ts';
import {layoutPlugin} from './tools/eslint-plugins/layout.ts';
import {namesPlugin} from './tools/eslint-plugins/names.ts';
import {testsPlugin} from './tools/eslint-plugins/tests.ts';

const ABBREVIATIONS = [
  'cfg',
  'ctx',
  'res',
  'req',
  'err',
  'evt',
  'fn',
  'cb',
  'tmp',
  'val',
  'idx',
  'len',
  'num',
  'str',
  'obj',
  'arr',
  'elem',
  'msg',
  'opts',
  'args',
];

// Short names ADR-0003 allows; names/scoped-exceptions restricts i, j, k, id and the type letters to their scopes. `now` is
// the clock's own word and is allowed anywhere.
const SHORT_NAME_EXCEPTIONS = [
  'i',
  'j',
  'k',
  'x',
  'y',
  'id',
  'now',
  'T',
  'K',
  'V',
];

// Property keys shorter than four characters that a third-party API imposes, each with the API.
const IMPOSED_PROPERTY_KEYS = [
  // ESLint: the `loc` of a report descriptor, the `end` of a source location, the `min` of id-length.
  'loc',
  'end',
  'min',
  // Node.js child_process: the `cwd` and `env` of spawn options; @vscode/test-cli: the `env` of a configuration.
  'cwd',
  'env',
  // Mocha: the `ui` option.
  'ui',
  // VS Code: the `t` of `l10n.t`.
  't',
  // VS Code extension manifest: the `url` of the `repository` and `bugs` objects.
  'url',
  // VS Code: the `uri` of the openFolder command core executes.
  'uri',
  // The identifier inventory of the Remote - SSH package (ADR-0008): a setting's `key`, and the context keys the
  // package sets itself (`own`) and reads (`read`).
  'key',
  'own',
  'read',
  // The server's result block (its `host.os` fact) and the editor CLI's download template (its `os` variable).
  'os',
  // VS Code: the `all` of `extensions.all`, and the `get` of a `Memento` (an extension's global state).
  'all',
  'get',
  // The environment: the `CI` flag every runner sets, which the package run's mode reads (tooling-46).
  'CI',
];

// Phrases that address a reader of a conversation rather than of the code (ADR-0003, comments). An entry with an
// upper-case letter matches case-sensitively; a trailing `*` matches a prefix.
const CONVERSATION_PHRASES = [
  'note that',
  'sorry',
  'apolog*',
  "let's",
  'as you can see',
  'basically',
  'simply',
  'just',
  'obviously',
  'this function',
  'we need to',
  'I ',
];

const TYPESCRIPT_PROJECTS = [
  './tools/tsconfig.json',
  './packages/*/tsconfig.json',
  './packages/*/tsconfig.test.json',
  './tests/acceptance/tsconfig.json',
  './tests/acceptance/server/tsconfig.json',
  './tests/acceptance/containers-cli/tsconfig.json',
  './tests/acceptance/windows/tsconfig.json',
  './tests/acceptance/config-files/tsconfig.json',
  './tests/acceptance/no-proposals/tsconfig.json',
  './tests/acceptance/default-ports/tsconfig.json',
  './tests/acceptance/terminal-pick/tsconfig.json',
  './tests/acceptance/explorer/tsconfig.json',
  './tests/acceptance/explorer-alone/tsconfig.json',
  './tests/acceptance/explorer-no-proposals/tsconfig.json',
  './tests/acceptance/trust/tsconfig.json',
  './tests/acceptance/trust-terminal/tsconfig.json',
  './tests/acceptance/containers/tsconfig.json',
  './tests/acceptance/containers-standdown/tsconfig.json',
  './tests/acceptance/containers-no-proposals/tsconfig.json',
  './tests/acceptance/containers-trust/tsconfig.json',
  './tests/acceptance/containers-volume/tsconfig.json',
];

const DEFAULT_EXPORT_BAN = {
  selector: 'ExportDefaultDeclaration',
  message: 'No default exports (style guide: exports).',
};

// ESLint, Prettier and @vscode/test-cli read these files' default export, so DEFAULT_EXPORT_BAN skips them.
const DEFAULT_EXPORT_FILES = [
  'eslint.config.ts',
  'prettier.config.ts',
  '.vscode-test.mjs',
  'tests/acceptance/vscode-test.mjs',
];

// ADR-0002, decision 9: Node's type stripping resolves a relative import only by its full file name.
const RELATIVE_SOURCE_WITHOUT_EXTENSION =
  'Literal.source[value=/^\\.\\.?\\//][value!=/\\.(ts|mts|json)$/]';

const SYNTAX_BANS = [
  {
    selector: `:matches(ImportDeclaration, ExportNamedDeclaration, ExportAllDeclaration, ImportExpression) > ${RELATIVE_SOURCE_WITHOUT_EXTENSION}`,
    message:
      'A relative import names its file with the extension: .ts, .mts or .json (ADR-0002, decision 9).',
  },
  {
    selector: 'ExportNamedDeclaration > VariableDeclaration[kind="let"]',
    message: 'No `export let` (style guide: exports).',
  },
  {
    selector: 'TSEnumDeclaration',
    message:
      'No `enum`: type stripping cannot erase it (ADR-0003); use a union of string literals or an `as const` object.',
  },
  {
    selector:
      'PropertyDefinition > PrivateIdentifier, MethodDefinition > PrivateIdentifier',
    message: 'No `#private` members; use `private` (style guide: classes).',
  },
  {
    selector: 'MethodDefinition[static=true][accessibility="private"]',
    message:
      'No private static methods; use a module-level function (style guide: classes).',
  },
  {
    selector:
      'NewExpression[callee.name=/^(String|Number|Boolean|Symbol|BigInt)$/]',
    message: 'No wrapper objects (style guide: primitives).',
  },
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/dist-*/',
      '**/.tsc/',
      '**/.vscode-test/',
      // The editor's own declaration files, kept as published.
      '**/vscode-dts/',
      'coverage/',
      'tests/conformance/runner/',
    ],
  },
  eslintJs.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  jsdoc.configs['flat/recommended-typescript-error'],
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: TYPESCRIPT_PROJECTS,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {comments: commentsPlugin, names: namesPlugin},
    // The guide documents a file with @fileoverview, which eslint-plugin-jsdoc otherwise renames to @file.
    settings: {jsdoc: {tagNamePreference: {file: 'fileoverview'}}},
    rules: {
      'comments/no-commented-out-code': 'error',
      'comments/no-conversation': ['error', {phrases: CONVERSATION_PHRASES}],
      'comments/todo-issue': 'error',
      'comments/line-comments': 'error',
      // The guide writes a multi-line implementation comment as several `//` lines; JSDoc is not affected.
      'multiline-comment-style': ['error', 'separate-lines'],
      'names/scoped-exceptions': 'error',
      'names/edge-underscore': ['error', {imposedKeys: IMPOSED_PROPERTY_KEYS}],
      'id-length': [
        'error',
        {
          min: 4,
          properties: 'always',
          exceptions: [...SHORT_NAME_EXCEPTIONS, ...IMPOSED_PROPERTY_KEYS],
        },
      ],
      'id-denylist': ['error', ...ABBREVIATIONS],
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
        },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/no-types': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/no-blank-blocks': 'error',
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'no-restricted-syntax': ['error', DEFAULT_EXPORT_BAN, ...SYNTAX_BANS],
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'one-var': ['error', 'never'],
      '@typescript-eslint/prefer-readonly': 'error',
      // Type stripping cannot erase parameter properties (ADR-0003).
      '@typescript-eslint/parameter-properties': [
        'error',
        {prefer: 'class-property'},
      ],
      'new-parens': 'error',
      'func-style': ['error', 'declaration'],
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'no-multi-str': 'error',
      eqeqeq: ['error', 'always', {null: 'ignore'}],
      'default-case': 'error',
      'default-case-last': 'error',
      'no-fallthrough': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      'no-empty': ['error', {allowEmptyCatch: false}],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {assertionStyle: 'as', objectLiteralTypeAssertions: 'never'},
      ],
      '@typescript-eslint/non-nullable-type-assertion-style': 'error',
      'no-debugger': 'error',
      'no-with': 'error',
      'no-eval': 'error',
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            '{}': 'Use `object`, `unknown` or a specific type.',
            String: 'Use `string`.',
            Number: 'Use `number`.',
            Boolean: 'Use `boolean`.',
            Symbol: 'Use `symbol`.',
            BigInt: 'Use `bigint`.',
            Object: 'Use `object`.',
          },
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/array-type': ['error', {default: 'array-simple'}],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {args: 'after-used', ignoreRestSiblings: false},
      ],
      'no-unreachable': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    plugins: {tests: testsPlugin},
    rules: {
      'tests/one-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {'ts-expect-error': 'allow-with-description'},
      ],
    },
  },
  {
    files: DEFAULT_EXPORT_FILES,
    rules: {'no-restricted-syntax': ['error', ...SYNTAX_BANS]},
  },
  {
    // typescript-eslint names an option of no-unused-vars `args`.
    files: ['eslint.config.ts'],
    rules: {
      'id-denylist': [
        'error',
        ...ABBREVIATIONS.filter(abbreviation => abbreviation !== 'args'),
      ],
    },
  },
  {
    // Comments of the code that ships or that the public repository shows describe the product (ADR-0008). Tests,
    // test helpers and the generated tables are not shipped, and lib-product's table names products by design.
    files: ['packages/*/src/**/*.ts', 'tools/**/*.ts', '*.config.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.fixture.ts',
      'packages/*/src/testing/**',
      'packages/*/src/*.generated.ts',
      'packages/lib-product/src/product-table.ts',
    ],
    rules: {'comments/public-surface': 'error'},
  },
  {
    // Test doubles live under src/testing/ and are imported only by tests, so no bundle can carry one.
    files: ['packages/*/src/**/*.ts'],
    ignores: ['packages/*/src/testing/**', '**/*.test.ts', '**/*.fixture.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)testing/',
              message: 'Test doubles under src/testing/ are for tests only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['packages/**/*.{ts,mts,cts,js,mjs,cjs}'],
    plugins: {layout: layoutPlugin},
    rules: {
      'layout/package-imports': ['error', {root: import.meta.dirname}],
      'layout/no-intra-package-cycles': ['error', {root: import.meta.dirname}],
    },
  },
);
