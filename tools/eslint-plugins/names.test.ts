import {RuleTester} from 'eslint';
import tseslint from 'typescript-eslint';
import {namesPlugin} from './names.ts';

const ruleTester = new RuleTester({languageOptions: {parser: tseslint.parser}});

ruleTester.run('scoped-exceptions', namesPlugin.rules['scoped-exceptions'], {
  valid: [
    {code: 'for (let i = 0; i < 3; i++) {\n  count(i);\n}'},
    {code: 'for (let i = 0, j = 9; i < j; i++, j--) {\n  swap(i, j);\n}'},
    {code: 'const record = {id: 1};\nuse(record.id);'},
    {
      code: 'function first<T>(items: T[]): T | undefined {\n  return items[0];\n}',
    },
    {code: 'const point = {x: 1, y: 2};'},
  ],
  invalid: [
    {
      code: 'const i = 0;',
      errors: [{messageId: 'loopIndex', data: {name: 'i'}}],
    },
    {
      code: 'for (let k = 0; k < 3; k++) {\n  one(k);\n  two(k);\n  three(k);\n  four(k);\n}',
      errors: [{messageId: 'loopIndex', data: {name: 'k'}}],
    },
    {
      code: 'for (const j of items) {\n  use(j);\n}',
      errors: [{messageId: 'loopIndex', data: {name: 'j'}}],
    },
    {
      code: 'const {id} = record;',
      errors: [{messageId: 'idBinding'}],
    },
    {
      code: 'function remove(id: number) {\n  drop(id);\n}',
      errors: [{messageId: 'idBinding'}],
    },
    {
      code: 'const T = 1;',
      errors: [{messageId: 'typeLetter', data: {name: 'T'}}],
    },
  ],
});
