import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {
  checkLicences,
  dependencyChain,
  isAllowedExpression,
  type LicensedPackage,
  runPnpm,
} from './licences.ts';

const JSDOC_CHAIN = {
  name: 'spdx-exceptions',
  version: '2.5.0',
  dependents: [
    {
      name: 'eslint-plugin-jsdoc',
      version: '65.1.0',
      dependents: [
        {name: 'remote', version: '0.0.0', depField: 'devDependencies'},
      ],
    },
  ],
};

function fakePnpm(
  installed: Record<string, LicensedPackage[]>,
  runtime: Record<string, LicensedPackage[]> = {},
) {
  return (pnpmArguments: string[]): string => {
    if (pnpmArguments[0] === 'why') {
      return JSON.stringify([{...JSDOC_CHAIN, name: pnpmArguments[1]}]);
    }
    return JSON.stringify(
      pnpmArguments.includes('--prod') ? runtime : installed,
    );
  };
}

function entry(name: string): LicensedPackage {
  return {name, versions: ['1.0.0']};
}

describe('licences', () => {
  describe('expressions', () => {
    it('allow a licence on the list', () => {
      strictEqual(isAllowedExpression('MIT'), true);
    });

    it('reject a licence off the list', () => {
      strictEqual(isAllowedExpression('GPL-3.0-only'), false);
    });

    it('allow an OR with one allowed branch', () => {
      strictEqual(isAllowedExpression('(MIT OR GPL-3.0-or-later)'), true);
    });

    it('allow an AND only when every part is allowed', () => {
      strictEqual(isAllowedExpression('(MIT AND Zlib)'), true);
    });

    it('reject an AND with one part off the list', () => {
      strictEqual(isAllowedExpression('MIT AND CC-BY-3.0'), false);
    });

    it('respect nested parentheses', () => {
      strictEqual(
        isAllowedExpression(
          '(GPL-2.0-only OR (MIT AND (ISC OR GPL-3.0-only)))',
        ),
        true,
      );
    });

    it('keep two parenthesised groups apart', () => {
      strictEqual(isAllowedExpression('(MIT) AND (GPL-2.0-only)'), false);
    });
  });

  describe('chains', () => {
    it('follow the first dependent up to the root', () => {
      strictEqual(
        dependencyChain(JSDOC_CHAIN),
        'spdx-exceptions@2.5.0 <- eslint-plugin-jsdoc@65.1.0 <- remote@0.0.0 (devDependencies)',
      );
    });

    it('name a node without a version by its name', () => {
      strictEqual(dependencyChain({name: 'remote'}), 'remote');
    });
  });

  describe('pnpm', () => {
    it('passes on the installed tree of the repository', function () {
      this.timeout(60_000);
      deepStrictEqual(checkLicences(), []);
    });

    it('throws when pnpm fails', () => {
      throws(() => runPnpm(['no-such-command']), /pnpm no-such-command failed/);
    });
  });

  describe('check', () => {
    it('asks pnpm about every workspace package', () => {
      const calls: string[][] = [];
      const recording = fakePnpm({'GPL-3.0-only': [entry('copyleft')]});
      checkLicences(pnpmArguments => {
        calls.push(pnpmArguments);
        return recording(pnpmArguments);
      });
      deepStrictEqual(
        calls.map(call => call.includes('--recursive')),
        [true, true, true],
      );
    });

    it('passes an allowed tree and an excepted dev dependency', () => {
      deepStrictEqual(
        checkLicences(
          fakePnpm({
            'Apache-2.0': [entry('typescript')],
            'CC-BY-3.0': [entry('spdx-exceptions')],
          }),
        ),
        [],
      );
    });

    it('reports a licence off the list with its chain', () => {
      deepStrictEqual(
        checkLicences(fakePnpm({'GPL-3.0-only': [entry('copyleft')]})),
        [
          "copyleft@1.0.0 has licence 'GPL-3.0-only', which is not on the allowlist; installed through copyleft@2.5.0 <- eslint-plugin-jsdoc@65.1.0 <- remote@0.0.0 (devDependencies)",
        ],
      );
    });

    it('reports a package without a licence or with UNLICENSED', () => {
      deepStrictEqual(
        checkLicences(
          fakePnpm({
            Unknown: [entry('nameless')],
            UNLICENSED: [entry('private-tool')],
          }),
        ).map(problem => problem.split(';')[0]),
        [
          "nameless@1.0.0 has no licence ('Unknown')",
          "private-tool@1.0.0 has no licence ('UNLICENSED')",
        ],
      );
    });

    it('reports an excepted package that is a runtime dependency', () => {
      const tree = {'CC-BY-3.0': [entry('spdx-exceptions')]};
      deepStrictEqual(
        checkLicences(fakePnpm(tree, tree)).map(
          problem => problem.split(';')[0],
        ),
        [
          'spdx-exceptions@1.0.0 is excepted for dev use only (CC-BY-3.0) but is a runtime dependency',
        ],
      );
    });
  });
});
