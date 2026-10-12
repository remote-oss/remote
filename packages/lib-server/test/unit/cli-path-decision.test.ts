import {deepStrictEqual} from 'node:assert';
import {
  type CliPathInput,
  cliArchiveTemplateVariables,
  decideCliPath,
} from '../../src/index.ts';

const BUILDS = ['linux-x64', 'alpine-x64', 'alpine-arm64', 'linux-armhf'];

function inputWith(overrides: Partial<CliPathInput> = {}): CliPathInput {
  return {
    productCliTemplate:
      'https://example.invalid/${commit}/${os}-${arch}.tar.gz',
    hostPlatform: {operatingSystem: 'linux', architecture: 'x64'},
    cliBuildsAvailable: BUILDS,
    useExecServerSetting: true,
    cliPresentOnHost: false,
    serverPresentOnHost: false,
    ...overrides,
  };
}

describe('decideCliPath (card ssh-08 table)', () => {
  it('a server on the host is reused whatever else is favourable', () => {
    deepStrictEqual(decideCliPath(inputWith({serverPresentOnHost: true})), {
      kind: 'bootstrap',
      reason: 'serverPresent',
    });
  });

  it('a setting that is off chooses the bootstrap', () => {
    deepStrictEqual(decideCliPath(inputWith({useExecServerSetting: false})), {
      kind: 'bootstrap',
      reason: 'settingOff',
    });
  });

  it('a product without a template chooses the bootstrap', () => {
    deepStrictEqual(decideCliPath(inputWith({productCliTemplate: undefined})), {
      kind: 'bootstrap',
      reason: 'noTemplate',
    });
  });

  it('a platform with no published build chooses the bootstrap', () => {
    deepStrictEqual(
      decideCliPath(
        inputWith({
          hostPlatform: {operatingSystem: 'alpine', architecture: 'armhf'},
        }),
      ),
      {kind: 'bootstrap', reason: 'noBuildForPlatform'},
    );
  });

  it('a favourable host without the program downloads it', () => {
    deepStrictEqual(decideCliPath(inputWith()), {kind: 'cli', download: true});
  });

  it('a favourable host with the program does not download it', () => {
    deepStrictEqual(decideCliPath(inputWith({cliPresentOnHost: true})), {
      kind: 'cli',
      download: false,
    });
  });
});

describe('cliArchiveTemplateVariables (card ssh-08 table)', () => {
  it('fills the variables, with the release equal to the version', () => {
    deepStrictEqual(
      cliArchiveTemplateVariables(
        {commit: 'abc', quality: 'stable', version: '1.135.06055'},
        {operatingSystem: 'linux', architecture: 'x64'},
      ),
      Object.fromEntries([
        ['os', 'linux'],
        ['arch', 'x64'],
        ['commit', 'abc'],
        ['quality', 'stable'],
        ['version', '1.135.06055'],
        ['release', '1.135.06055'],
      ]),
    );
  });
});
