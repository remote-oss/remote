import {deepStrictEqual} from 'node:assert';
import {createWslHostChannel} from '../../src/host-channel.ts';
import {createPathMapper} from '../../src/path-mapper.ts';
import {createWslRunner} from '../../src/runner.ts';
import {type FakeRun, fakeWsl, utf8Output} from '../../src/testing/fake-wsl.ts';

/** The mapper over a fake whose every process gives `run`, with the fake. */
function mapperOver(behaviour: FakeRun) {
  const fake = fakeWsl(() => behaviour);
  const runner = createWslRunner(fake);
  return {fake, runner, mapper: createPathMapper(runner)};
}

const NEVER = new AbortController().signal;

describe('D3: the path mapper’s process half', () => {
  it('cw01 toDistro: a path on a share is read without a process', async () => {
    const {fake, mapper} = mapperOver({kind: 'exits', status: 0});
    deepStrictEqual(
      [
        await mapper.toDistro(
          '\\\\wsl.localhost\\Debian\\home\\me',
          'Ubuntu',
          NEVER,
        ),
        fake.started.length,
      ],
      [{kind: 'mapped', mapped: {distro: 'Debian', linuxPath: '/home/me'}}, 0],
    );
  });

  it('cw01 toDistro: a drive path runs wslpath -u in the target distro', async () => {
    const {fake, mapper} = mapperOver({
      kind: 'exits',
      stdout: utf8Output('/mnt/c/Users/me\n'),
      status: 0,
    });
    await mapper.toDistro('C:\\Users\\me', 'Ubuntu', NEVER);
    deepStrictEqual(fake.started[0]?.programArguments, [
      '-d',
      'Ubuntu',
      '--cd',
      '~',
      '--exec',
      'wslpath',
      '-u',
      '--',
      'C:\\Users\\me',
    ]);
  });

  it('cw01 toDistro: a drive path gives the path wslpath printed, under the automount root of the distro', async () => {
    const {mapper} = mapperOver({
      kind: 'exits',
      stdout: utf8Output('/windir/c/Users/me\n'),
      status: 0,
    });
    deepStrictEqual(await mapper.toDistro('C:\\Users\\me', 'Ubuntu', NEVER), {
      kind: 'mapped',
      mapped: {distro: 'Ubuntu', linuxPath: '/windir/c/Users/me'},
    });
  });

  it('cw01 toDistro: spaces and non-ASCII characters pass unchanged', async () => {
    const {fake, mapper} = mapperOver({
      kind: 'exits',
      stdout: utf8Output('/mnt/c/Users/Zoë Fox/my file\n'),
      status: 0,
    });
    const mapped = await mapper.toDistro(
      'C:\\Users\\Zoë Fox\\my file',
      'Ubuntu',
      NEVER,
    );
    deepStrictEqual(
      [mapped.kind, fake.started[0]?.programArguments.at(-1)],
      ['mapped', 'C:\\Users\\Zoë Fox\\my file'],
    );
  });

  it('cw01 toDistro: a wslpath that prints nothing usable is not translatable', async () => {
    const {mapper} = mapperOver({kind: 'exits', status: 0});
    const mapped = await mapper.toDistro('X:\\gone', 'Ubuntu', NEVER);
    deepStrictEqual(mapped.kind, 'notTranslatable');
  });

  it('F-6204 (reading-2348-share-host): a path that is neither a drive path nor on a share is not translatable and starts no process', async () => {
    const {fake, mapper} = mapperOver({kind: 'exits', status: 0});
    const mapped = await mapper.toDistro(
      '\\\\localhost\\C$\\x',
      'Ubuntu',
      NEVER,
    );
    deepStrictEqual([mapped.kind, fake.started.length], ['notTranslatable', 0]);
  });

  it('F-6204: a wslpath output that does not start with / is not translatable', async () => {
    const {mapper} = mapperOver({
      kind: 'exits',
      stdout: utf8Output('C:Users\n'),
      status: 0,
    });
    const mapped = await mapper.toDistro('C:\\Users', 'Ubuntu', NEVER);
    deepStrictEqual(mapped.kind, 'notTranslatable');
  });

  it('cw01 toDistro: a wslpath that fails is not translatable, with its status named', async () => {
    const {mapper} = mapperOver({
      kind: 'exits',
      stdout: utf8Output('/mnt/x/gone\n'),
      status: 1,
    });
    const mapped = await mapper.toDistro('X:\\gone', 'Ubuntu', NEVER);
    deepStrictEqual(
      mapped.kind === 'notTranslatable' ? mapped.detail : mapped.kind,
      'wslpath -u gave status 1 for X:\\gone',
    );
  });

  it('cw01 toDistro: a failure of the runner is passed on', async () => {
    const {mapper} = mapperOver({
      kind: 'failsToStart',
      error: {code: 'EMFILE', message: 'too many open files'},
    });
    const mapped = await mapper.toDistro('C:\\x', 'Ubuntu', NEVER);
    deepStrictEqual(
      mapped.kind === 'failed' ? mapped.failure.kind : mapped.kind,
      'spawnFailed',
    );
  });
});

describe('D3: toWindows', () => {
  async function windowsOf(
    behaviour: FakeRun,
    linuxPath = '/home/me',
    host: 'wsl$' | 'wsl.localhost' = 'wsl.localhost',
  ) {
    const {fake, mapper} = mapperOver(behaviour);
    const result = await mapper.toWindows('Ubuntu', linuxPath, host, NEVER);
    return {fake, result};
  }

  it('F-6204: a relative path is not translatable and starts no process', async () => {
    const {fake, result} = await windowsOf(
      {kind: 'exits', status: 0},
      'home/me',
    );
    deepStrictEqual([result.kind, fake.started.length], ['notTranslatable', 0]);
  });

  it('F-6204: wslpath -w is asked in the distro with -- before the path', async () => {
    const {fake} = await windowsOf({
      kind: 'exits',
      stdout: utf8Output('C:\\Users\n'),
      status: 0,
    });
    deepStrictEqual(fake.started[0]?.programArguments, [
      '-d',
      'Ubuntu',
      '--cd',
      '~',
      '--exec',
      'wslpath',
      '-w',
      '--',
      '/home/me',
    ]);
  });

  it('F-6204: a drive form is the result as printed', async () => {
    const {result} = await windowsOf({
      kind: 'exits',
      stdout: utf8Output('C:\\Users\\me\n'),
      status: 0,
    });
    deepStrictEqual(result, {kind: 'mapped', windowsPath: 'C:\\Users\\me'});
  });

  it('F-6203 (reading-2348-share-host): a share form is rebuilt from the call’s inputs, whatever distro, host or folder it names', async () => {
    const {result} = await windowsOf(
      {
        kind: 'exits',
        stdout: utf8Output('\\\\WSL$\\Other\\elsewhere\n'),
        status: 0,
      },
      '/home/me',
      'wsl$',
    );
    deepStrictEqual(result, {
      kind: 'mapped',
      windowsPath: '\\\\wsl$\\Ubuntu\\home\\me',
    });
  });

  const dotted = [
    [
      'a .. segment is resolved before the path is put on the share',
      '/home/me/../you',
      '\\\\wsl.localhost\\Ubuntu\\home\\you',
    ],
    [
      'a . segment and a doubled slash are dropped',
      '/home/./me//docs',
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\docs',
    ],
    [
      '.. above the root stays at the root, so no other distro can be named',
      '/../../Other/x',
      '\\\\wsl.localhost\\Ubuntu\\Other\\x',
    ],
    ['the root alone is the share root', '/..', '\\\\wsl.localhost\\Ubuntu\\'],
  ] as const;
  for (const [label, linuxPath, share] of dotted) {
    it(`#2515: ${label}`, async () => {
      const {result} = await windowsOf(
        {
          kind: 'exits',
          stdout: utf8Output('\\\\wsl.localhost\\Other\\anything\n'),
          status: 0,
        },
        linuxPath,
      );
      deepStrictEqual(result, {kind: 'mapped', windowsPath: share});
    });
  }

  const unusable = [
    ['another UNC host', '\\\\server\\share\n', 0],
    ['a control character', 'C:\\a\u0007b\n', 0],
    ['two lines', 'C:\\a\nC:\\b\n', 0],
    ['no line', '', 0],
    ['a non-zero status', 'C:\\a\n', 1],
  ] as const;
  for (const [label, printed, status] of unusable) {
    it(`F-6204: ${label} is not translatable`, async () => {
      const {result} = await windowsOf({
        kind: 'exits',
        stdout: utf8Output(printed),
        status,
      });
      deepStrictEqual(result.kind, 'notTranslatable');
    });
  }

  it('F-6204: a failure of the runner is passed on', async () => {
    const {result} = await windowsOf({
      kind: 'failsToStart',
      error: {code: 'EMFILE', message: 'too many open files'},
    });
    deepStrictEqual(
      result.kind === 'failed' ? result.failure.kind : result.kind,
      'spawnFailed',
    );
  });
});

describe('D1: -u appears only on the root install’s path', () => {
  it('cw01 -u: a script, a copy and two path questions give wsl.exe no user option (the -u after --exec is wslpath’s own)', async () => {
    const {fake, runner, mapper} = mapperOver({
      kind: 'exits',
      stdout: utf8Output('/mnt/c/x\n'),
      status: 0,
    });
    fake.local.set('C:\\x', new Uint8Array(1));
    const channel = createWslHostChannel({runner, mapper, distro: 'Ubuntu'});
    await channel.runScript(
      {
        script: 'true',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: NEVER,
      },
      () => undefined,
    );
    await channel.copyToHost({
      localFile: 'C:\\x',
      remotePath: '/x',
      cancellation: NEVER,
    });
    await channel.clientPathOnHost?.('C:\\x');
    await mapper.toDistro('C:\\x', 'Ubuntu', NEVER);
    deepStrictEqual(
      fake.started.map(each =>
        each.programArguments
          .slice(0, each.programArguments.indexOf('--exec'))
          .includes('-u'),
      ),
      [false, false, false, false, false],
    );
  });
});

describe('D4: the channel’s own rules', () => {
  /** A channel over a fake whose processes all give `run`. */
  function channelOver(behaviour: FakeRun) {
    const {fake, runner, mapper} = mapperOver(behaviour);
    return {
      fake,
      channel: createWslHostChannel({runner, mapper, distro: 'Ubuntu'}),
    };
  }

  it('cw01 channel: identifies itself by the registered distro name and hints linux', () => {
    const {channel} = channelOver({kind: 'exits', status: 0});
    deepStrictEqual(
      [channel.identity(), channel.platformHint()],
      ['Ubuntu', 'linux'],
    );
  });

  it('cw01 channel: a PowerShell script is spawnFailed and starts nothing', async () => {
    const {fake, channel} = channelOver({kind: 'exits', status: 0});
    const outcome = await channel.runScript(
      {
        script: 'x',
        interpreter: 'powershell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: NEVER,
      },
      () => undefined,
    );
    deepStrictEqual(
      [
        outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
        fake.started.length,
      ],
      ['spawnFailed', 0],
    );
  });

  it('cw01 channel: a script runs as sh -c with the prelude command, in the home folder', async () => {
    const {fake, channel} = channelOver({kind: 'exits', status: 0});
    await channel.runScript(
      {
        script: 'abc',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: NEVER,
      },
      () => undefined,
    );
    deepStrictEqual(fake.started[0]?.programArguments.slice(0, 7), [
      '-d',
      'Ubuntu',
      '--cd',
      '~',
      '--exec',
      'sh',
      '-c',
    ]);
  });

  it('cw01 channel: the prelude names the byte count of the script and its line end', async () => {
    const {fake, channel} = channelOver({kind: 'exits', status: 0});
    await channel.runScript(
      {
        script: 'é',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: NEVER,
      },
      () => undefined,
    );
    deepStrictEqual(
      fake.started[0]?.programArguments.at(-1)?.includes('count=3'),
      true,
    );
  });

  it('cw01 channel: a copy to a path with spaces passes the path as one argument', async () => {
    const {fake, channel} = channelOver({kind: 'writesInput'});
    fake.local.set('C:\\x', new Uint8Array(1));
    await channel.copyToHost({
      localFile: 'C:\\x',
      remotePath: '/home/my dir/x',
      cancellation: NEVER,
    });
    deepStrictEqual(fake.started[0]?.programArguments.slice(-4), [
      '-c',
      'cat > "$1"',
      'sh',
      '/home/my dir/x',
    ]);
  });

  it('cw01 channel: a copy whose cat fails is copyFailed with the status named', async () => {
    const {fake, channel} = channelOver({
      kind: 'afterInput',
      then: {kind: 'exits', status: 1},
    });
    fake.local.set('C:\\x', new Uint8Array(1));
    const outcome = await channel.copyToHost({
      localFile: 'C:\\x',
      remotePath: '/x',
      cancellation: NEVER,
    });
    deepStrictEqual(
      outcome.kind === 'failed'
        ? [outcome.failure.kind, outcome.failure.detail]
        : outcome.kind,
      ['copyFailed', 'cat ended with status 1'],
    );
  });

  it('cw01 channel: a client path in another distro’s share is not read in place', async () => {
    const {channel} = channelOver({kind: 'exits', status: 0});
    deepStrictEqual(
      await channel.clientPathOnHost?.(
        '\\\\wsl.localhost\\Debian\\home\\me\\x',
      ),
      undefined,
    );
  });

  it('cw01 channel: a client path under a custom automount root is read in place when the distro can read it', async () => {
    const {fake, channel} = channelOver({
      kind: 'exits',
      stdout: utf8Output('/windir/c/x\n'),
      status: 0,
    });
    deepStrictEqual(
      [
        await channel.clientPathOnHost?.('C:\\x'),
        fake.started.at(-1)?.programArguments.slice(-4),
      ],
      ['/windir/c/x', ['-c', 'test -r "$1"', 'sh', '/windir/c/x']],
    );
  });

  it('cw01 channel: a mapped client path the distro cannot read (automount off) is not read in place', async () => {
    const behaviours: FakeRun[] = [
      {kind: 'exits', stdout: utf8Output('/mnt/c/x\n'), status: 0},
      {kind: 'exits', status: 1},
    ];
    let index = 0;
    const fake = fakeWsl(
      () => behaviours[index++] ?? behaviours[1] ?? {kind: 'exits', status: 1},
    );
    const runner = createWslRunner(fake);
    const channel = createWslHostChannel({
      runner,
      mapper: createPathMapper(runner),
      distro: 'Ubuntu',
    });
    deepStrictEqual(
      [await channel.clientPathOnHost?.('C:\\x'), fake.started.length],
      [undefined, 2],
    );
  });

  it('cw01 channel: the readable test passes a path with spaces and quotes as one argument', async () => {
    const {fake, channel} = channelOver({
      kind: 'exits',
      stdout: utf8Output('/mnt/c/My "dir"/it\'s x\n'),
      status: 0,
    });
    await channel.clientPathOnHost?.('C:\\My "dir"\\it\'s x');
    deepStrictEqual(fake.started.at(-1)?.programArguments.slice(-4), [
      '-c',
      'test -r "$1"',
      'sh',
      '/mnt/c/My "dir"/it\'s x',
    ]);
  });

  it('cw01 channel: a client path on a share of the channel’s own distro is not a drive path and starts no process', async () => {
    const {fake, channel} = channelOver({kind: 'exits', status: 0});
    deepStrictEqual(
      [
        await channel.clientPathOnHost?.(
          '\\\\wsl.localhost\\Ubuntu\\home\\me\\x',
        ),
        fake.started.length,
      ],
      [undefined, 0],
    );
  });

  it('cw01 channel: a copy to a path with spaces and quotes passes the path as one argument', async () => {
    const {fake, channel} = channelOver({kind: 'writesInput'});
    fake.local.set('C:\\x', new Uint8Array(1));
    await channel.copyToHost({
      localFile: 'C:\\x',
      remotePath: '/home/my "dir"/it\'s $x',
      cancellation: NEVER,
    });
    deepStrictEqual(fake.started[0]?.programArguments.slice(-4), [
      '-c',
      'cat > "$1"',
      'sh',
      '/home/my "dir"/it\'s $x',
    ]);
  });

  it('cw01 channel: a missing wsl.exe fails a script as spawnFailed', async () => {
    const fake = fakeWsl(() => ({kind: 'exits', status: 0}), {
      systemRoot: undefined,
      environment: {},
    });
    const runner = createWslRunner(fake);
    const channel = createWslHostChannel({
      runner,
      mapper: createPathMapper(runner),
      distro: 'Ubuntu',
    });
    const outcome = await channel.runScript(
      {
        script: 'x',
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: ''},
        cancellation: NEVER,
      },
      () => undefined,
    );
    deepStrictEqual(
      outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
      'spawnFailed',
    );
  });
});
