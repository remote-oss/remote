import {deepStrictEqual} from 'node:assert';
import {createWslHostChannel} from '../../src/host-channel.ts';
import {createPathMapper} from '../../src/path-mapper.ts';
import {createWslRunner} from '../../src/runner.ts';
import {type FakeRun, fakeWsl, utf8Output} from '../../src/testing/fake-wsl.ts';

/** The mapper over a fake whose every process gives `run`, with the fake. */
function mapperOver(run: FakeRun) {
  const fake = fakeWsl(() => run);
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
      [false, false, false, false],
    );
  });
});

describe('D4: the channel’s own rules', () => {
  /** A channel over a fake whose processes all give `run`. */
  function channelOver(run: FakeRun) {
    const {fake, runner, mapper} = mapperOver(run);
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

  it('cw01 channel: a client path under a custom automount root is not read in place', async () => {
    const {channel} = channelOver({
      kind: 'exits',
      stdout: utf8Output('/windir/c/x\n'),
      status: 0,
    });
    deepStrictEqual(await channel.clientPathOnHost?.('C:\\x'), undefined);
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
