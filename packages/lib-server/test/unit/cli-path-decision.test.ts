import {deepStrictEqual} from 'node:assert';
import {
  CLI_PLATFORMS,
  type CliModeInput,
  cliArchiveTemplateVariables,
  decideCliMode,
} from '../../src/index.ts';

function inputWith(overrides: Partial<CliModeInput> = {}): CliModeInput {
  return {
    useExecServerSetting: true,
    manualBootstrap: false,
    socketMode: false,
    cliTemplate: 'https://example.invalid/${commit}/${os}-${arch}.tar.gz',
    hostPlatform: {operatingSystem: 'linux', architecture: 'x64'},
    sourcesFree: true,
    ...overrides,
  };
}

describe('decideCliMode (card cli-02 table)', () => {
  it('F-2103 BR-1: a setting that is off chooses the direct install', () => {
    deepStrictEqual(decideCliMode(inputWith({useExecServerSetting: false})), {
      kind: 'direct',
      reason: 'settingOff',
    });
  });

  it('F-2103 BR-3: a manual bootstrap chooses the direct install', () => {
    deepStrictEqual(decideCliMode(inputWith({manualBootstrap: true})), {
      kind: 'direct',
      reason: 'manualBootstrap',
    });
  });

  it('F-2410 AC-3: a socket-mode start chooses the direct install, because the CLI listens on a loopback port', () => {
    deepStrictEqual(decideCliMode(inputWith({socketMode: true})), {
      kind: 'direct',
      reason: 'socketMode',
    });
  });

  it('F-2410 AC-3: the setting that is off keeps its reason in socket mode', () => {
    deepStrictEqual(
      decideCliMode(inputWith({useExecServerSetting: false, socketMode: true})),
      {kind: 'direct', reason: 'settingOff'},
    );
  });

  it('brief §2 row 2: a product without a CLI source chooses the direct install', () => {
    deepStrictEqual(decideCliMode(inputWith({cliTemplate: ''})), {
      kind: 'direct',
      reason: 'noCliSource',
    });
  });

  it('brief §2 row 3: a platform the CLI is not built for chooses the direct install', () => {
    deepStrictEqual(
      decideCliMode(
        inputWith({
          hostPlatform: {operatingSystem: 'linux', architecture: 'riscv64'},
        }),
      ),
      {kind: 'direct', reason: 'noBuildForPlatform'},
    );
  });

  it('brief §2 row 3: a platform the CLI is built for is not refused for its platform', () => {
    deepStrictEqual(
      decideCliMode(
        inputWith({
          hostPlatform: {operatingSystem: 'alpine', architecture: 'arm64'},
        }),
      ),
      {kind: 'cli'},
    );
  });

  it('R-68, brief §5: sources that are not free choose the direct install', () => {
    deepStrictEqual(decideCliMode(inputWith({sourcesFree: false})), {
      kind: 'direct',
      reason: 'termsToAccept',
    });
  });

  it('brief §2: with every row passed the mode is the CLI', () => {
    deepStrictEqual(decideCliMode(inputWith()), {kind: 'cli'});
  });

  it('brief §2 order: the setting is judged before the source', () => {
    deepStrictEqual(
      decideCliMode(inputWith({useExecServerSetting: false, cliTemplate: ''})),
      {kind: 'direct', reason: 'settingOff'},
    );
  });

  it('brief §2 order: a manual bootstrap is judged before the source', () => {
    deepStrictEqual(
      decideCliMode(inputWith({manualBootstrap: true, cliTemplate: ''})),
      {kind: 'direct', reason: 'manualBootstrap'},
    );
  });

  it('brief §2 order: the source is judged before the platform', () => {
    deepStrictEqual(
      decideCliMode(
        inputWith({
          cliTemplate: '',
          hostPlatform: {operatingSystem: 'linux', architecture: 'riscv64'},
        }),
      ),
      {kind: 'direct', reason: 'noCliSource'},
    );
  });

  it('brief §2 order: the platform is judged before the terms', () => {
    deepStrictEqual(
      decideCliMode(
        inputWith({
          sourcesFree: false,
          hostPlatform: {operatingSystem: 'linux', architecture: 'riscv64'},
        }),
      ),
      {kind: 'direct', reason: 'noBuildForPlatform'},
    );
  });

  it('brief §3: the CLI is built for these eleven platforms, in this order', () => {
    deepStrictEqual(CLI_PLATFORMS, [
      'linux-x64',
      'linux-arm64',
      'linux-armhf',
      'linux-ppc64le',
      'linux-s390x',
      'alpine-x64',
      'alpine-arm64',
      'darwin-x64',
      'darwin-arm64',
      'win32-x64',
      'win32-arm64',
    ]);
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
