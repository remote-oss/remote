import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {ESLint, Linter} from 'eslint';
import repositoryConfig from '../eslint.config.ts';

const REPOSITORY_ROOT = path.join(import.meta.dirname, '..');
const RULE = 'no-restricted-imports';

/** What the repository's configuration gives the rule for a file. */
async function ruleFor(file: string): Promise<unknown[]> {
  const eslint = new ESLint({
    cwd: REPOSITORY_ROOT,
    overrideConfigFile: true,
    overrideConfig: repositoryConfig,
  });
  const config = (await eslint.calculateConfigForFile(
    path.join(REPOSITORY_ROOT, file),
  )) as {rules?: Record<string, unknown[]>} | undefined;
  return config?.rules?.[RULE] ?? [];
}

/** The level the configuration gives the rule for a file: `error`, or `off` when it is off or absent. */
async function levelFor(file: string): Promise<'error' | 'off'> {
  const [severity] = await ruleFor(file);
  return severity === 2 || severity === 'error' ? 'error' : 'off';
}

/** The options the configuration gives the rule for a source file of a package. */
async function optionsFor(file: string): Promise<unknown[]> {
  return (await ruleFor(file)).slice(1);
}

describe('the lint rule that keeps test doubles out of the product', () => {
  for (const [file, expected] of [
    ['packages/lib-companion/src/probe.ts', 'error'],
    ['packages/remote-explorer/src/model/probe.ts', 'error'],
    ['packages/lib-companion/src/testing/probe.ts', 'off'],
    ['packages/lib-companion/test/unit/probe.test.ts', 'off'],
    ['packages/lib-companion/src/probe.fixture.ts', 'off'],
  ] as const) {
    it(`F-5902.5.rules: no-restricted-imports for ${file} is ${expected}`, async () => {
      deepStrictEqual(await levelFor(file), expected);
    });
  }

  for (const [source, reported] of [
    ["import {x} from 'lib-companion/testing/recording-fake';", 1],
    ["import {x} from './testing/recording-fake';", 1],
    ["import {x} from '../testing/x';", 1],
    ["import {x} from 'lib-companion';", 0],
    ["import {x} from './protesting/x';", 0],
  ] as const) {
    it(`F-5902.5.rules: ${source} reports ${String(reported)} message`, async () => {
      const options = await optionsFor('packages/lib-companion/src/probe.ts');
      const linter = new Linter();
      const messages = linter.verify(
        source,
        [{files: ['**/*.ts'], rules: {[RULE]: ['error', ...options]}}],
        'probe.ts',
      );
      deepStrictEqual(
        messages.filter(
          message =>
            message.ruleId === RULE &&
            message.message.endsWith(
              'Test doubles under src/testing/ are for tests only.',
            ),
        ).length,
        reported,
      );
    });
  }
});
