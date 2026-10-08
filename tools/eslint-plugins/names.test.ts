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
    {code: 'type Pair<K, V> = Map<K, V>;'},
    {code: 'function wrap<Item>(item: Item): Item[] {\n  return [item];\n}'},
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
      code: 'function pick<U>(value: U): U {\n  return value;\n}',
      errors: [{messageId: 'typeParameter', data: {name: 'U'}}],
    },
    {
      code: 'type Box<Tt> = {content: Tt};',
      errors: [{messageId: 'typeParameter', data: {name: 'Tt'}}],
    },
    {
      code: 'interface Entry<AB> {\n  content: AB;\n}',
      errors: [{messageId: 'typeParameter', data: {name: 'AB'}}],
    },
    {
      code: 'const T = 1;',
      errors: [{messageId: 'typeLetter', data: {name: 'T'}}],
    },
  ],
});

ruleTester.run('edge-underscore', namesPlugin.rules['edge-underscore'], {
  valid: [
    {code: 'const MAX_RETRIES = 3;'},
    {code: "const value = {'__proto__': null};"},
    {
      code: 'const value = {inner_key: 1};',
      options: [{imposedKeys: ['inner_key']}],
    },
    {code: 'const counter = 1;'},
  ],
  invalid: [
    {
      code: 'const _value = 1;',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_value'}}],
    },
    {
      code: 'const value_ = 1;',
      errors: [{messageId: 'edgeUnderscore', data: {name: 'value_'}}],
    },
    {
      code: 'function run(_unused: number) {}',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_unused'}}],
    },
    {
      code: 'class Box { private _items = []; }',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_items'}}],
    },
    {
      code: 'interface Shape { _kind: string }',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_kind'}}],
    },
    {
      code: 'type Pair<_Left> = [_Left];',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_Left'}}],
    },
    {
      code: 'enum Mode { _Fast }',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_Fast'}}],
    },
    {
      code: "import {thing as _thing} from './thing.js';",
      errors: [{messageId: 'edgeUnderscore', data: {name: '_thing'}}],
    },
    {
      code: 'class Box { _run() {} }',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_run'}}],
    },
    {
      code: 'export {thing as _thing};',
      errors: [{messageId: 'edgeUnderscore', data: {name: '_thing'}}],
    },
  ],
});
