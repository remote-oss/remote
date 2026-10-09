import {RuleTester} from 'eslint';
import tseslint from 'typescript-eslint';
import {testsPlugin} from './tests.ts';

const ruleTester = new RuleTester({languageOptions: {parser: tseslint.parser}});
const {rules} = testsPlugin;

ruleTester.run('one-assertion', rules['one-assertion'], {
  valid: [
    {code: "it('adds', () => { deepStrictEqual(add(1, 2), 3); });"},
    {code: "it('adds', () => { assert.strictEqual(add(1, 2), 3); });"},
    {code: "it('adds', () => { assert.strict.equal(add(1, 2), 3); });"},
    {code: "it('adds', async () => { await rejects(add(), Error); });"},
    {code: "it.only('adds', () => { ok(add()); });"},
    {code: "it('has none', () => { add(); });"},
    {code: "test('adds', function () { match(add(), /3/); });"},
    {
      code: "describe('suite', () => { it('one', () => { ok(1); }); it('two', () => { ok(2); }); });",
    },
    {code: "it('calls a helper', () => { expectAdded(); expectAdded(); });"},
    {code: 'ok(1); ok(2);'},
    {code: "it('is not a test', 'name');"},
  ],
  invalid: [
    {
      code: "it('adds', () => { ok(add()); strictEqual(add(), 3); });",
      errors: [{messageId: 'tooMany', data: {count: '2'}}],
    },
    {
      code: "it('adds', () => { assert.ok(add()); assert.strict.equal(add(), 3); });",
      errors: [{messageId: 'tooMany'}],
    },
    {
      code: "it.skip('adds', () => { ok(1); ok(2); ok(3); });",
      errors: [{messageId: 'tooMany', data: {count: '3'}}],
    },
    {
      code: "it('adds', async () => { await rejects(add(), Error); throws(() => add()); });",
      errors: [{messageId: 'tooMany'}],
    },
    {
      code: "it('adds', () => { [1, 2].forEach(item => ok(item)); ok(3); });",
      errors: [{messageId: 'tooMany'}],
    },
    {
      code: "describe('suite', () => { it('one', () => { ok(1); ok(2); }); it('two', () => { ok(3); }); });",
      errors: [{messageId: 'tooMany', line: 1}],
    },
  ],
});
