import {deepStrictEqual} from 'node:assert';
import type {ResultBlock} from 'lib-server';
import {
  bannerLine,
  checkingLine,
  configFileLine,
  hostPlatformLine,
  loginShellLine,
  listeningLine,
  masked,
  maskOf,
  notValidLine,
  pathSettingLine,
  rejectedLine,
  resolvedLine,
  resolverLine,
  searchedLines,
  serverResultLine,
  usingLine,
} from '../../src/diagnostics/log-content.ts';

describe('the lines of a resolve and its ports (card connect-65)', () => {
  it('F-2003 BR-6 item 1: the resolver line names the authority and the attempt, and a reconnection says so', () => {
    deepStrictEqual(
      [
        resolverLine('harness', 1, false),
        resolverLine('harness', 3, true),
        resolverLine('host1.invalid', 2, false),
      ],
      [
        'Resolving ssh-remote+harness, attempt 1',
        'Resolving ssh-remote+harness, attempt 3, reconnection',
        'Resolving ssh-remote+host1.invalid, attempt 2',
      ],
    );
  });

  it('F-2003 BR-6 items 9 and 10: the listening and the resolved lines name their ports', () => {
    deepStrictEqual(
      [listeningLine(40000), resolvedLine('harness', 50000)],
      [
        'Remote server listening on port 40000',
        'Resolved ssh-remote+harness to local port 50000',
      ],
    );
  });

  it('F-2003 7.E6: the token is masked in every occurrence, as text, and an empty or absent token changes nothing', () => {
    deepStrictEqual(
      [
        masked('ab12-cd34 and ab12-cd34', 'ab12-cd34'),
        masked('x ab$&cd y', 'ab$&cd'),
        masked('keep ab12-cd34', ''),
        masked('keep ab12-cd34', undefined),
        maskOf('ab12-cd34'),
      ],
      [
        'aa11-aa11 and aa11-aa11',
        'x aa$&aa y',
        'keep ab12-cd34',
        'keep ab12-cd34',
        'aa11-aa11',
      ],
    );
  });
});

describe('the lines of the client search and the probed platform (card connect-28)', () => {
  it('F-2101 §9: the setting is shown as JSON text', () => {
    deepStrictEqual(
      [pathSettingLine(''), pathSettingLine('/opt/a "b"/ssh')],
      ['remote.SSH.path = ""', 'remote.SSH.path = "/opt/a \\"b\\"/ssh"'],
    );
  });

  it('F-2101 §9: a check, its banner, a rejection and a use each have their line', () => {
    deepStrictEqual(
      [
        checkingLine('ssh'),
        bannerLine('OpenSSH_9.6p1'),
        rejectedLine('ssh', 'exit status 1'),
        notValidLine('/x/ssh'),
        usingLine('ssh'),
      ],
      [
        'Checking ssh client: ssh',
        'ssh client: OpenSSH_9.6p1',
        'ssh client ssh was rejected: exit status 1',
        'remote.SSH.path "/x/ssh" is not a valid SSH binary',
        'Using ssh client: ssh',
      ],
    );
  });

  it('F-2201 §9: the configuration file in use has its line', () => {
    deepStrictEqual(
      configFileLine('/home/a/cfg'),
      'SSH configuration file in use: /home/a/cfg',
    );
  });

  it('F-2101 §9: each folder of the search path is a line, in order', () => {
    deepStrictEqual(searchedLines(['/b', '/a']), [
      'Searched for ssh in: /b',
      'Searched for ssh in: /a',
    ]);
  });

  it('F-2101 §9: no folder is no line', () => {
    deepStrictEqual(searchedLines([]), []);
  });

  it('F-2206 §9: the host platform is its system and architecture', () => {
    deepStrictEqual(
      hostPlatformLine({operatingSystem: 'linux', architecture: 'arm64'}),
      'Host platform: linux arm64',
    );
  });
});

describe('the login shell in the log (card coverage-49)', () => {
  it('F-2704 BR-2: the login shell the probe found is named in a line', () => {
    deepStrictEqual(
      loginShellLine({loginShell: '/usr/bin/zsh'}),
      "the host's login shell is /usr/bin/zsh (zsh)",
    );
  });

  it('F-2704 BR-2: a host that reported no login shell gives no line', () => {
    deepStrictEqual(loginShellLine({loginShell: ''}), undefined);
  });
});

describe('the server result and the progress in the log (card connect-67)', () => {
  /** A parsed block with `facts`, as lib-server gives it. */
  function parsedBlock(
    facts: Partial<Pick<ResultBlock, 'hostFacts' | 'serverFacts' | 'timings'>>,
  ): ResultBlock {
    return {
      status: 'Ok',
      hostFacts: {},
      serverFacts: {},
      cliFacts: {},
      timings: {},
      ...facts,
    };
  }

  it('F-2003 BR-6 item 8: the result is logged as one summary line from the parsed block', () => {
    deepStrictEqual(
      serverResultLine(
        parsedBlock({
          hostFacts: {os: 'linux', arch: 'x64', display: ':10'},
          serverFacts: {port: '41234', token: 'secret'},
          timings: {download: 1200, install: 800, start: 90},
        }),
      ),
      'Server result: Ok, port 41234, os linux, architecture x64, download 1200 ms, install 800 ms',
    );
  });

  it('F-2003 BR-14: the summary has only the parts the block has, and no other fact', () => {
    deepStrictEqual(
      serverResultLine(parsedBlock({hostFacts: {sshAuthSock: '/tmp/a'}})),
      'Server result: Ok',
    );
  });
});
