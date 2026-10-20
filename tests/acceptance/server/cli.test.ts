import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {copyFileSync} from 'node:fs';
import {createLogger} from 'lib-log';
import {nodeLocalPort, socksDialer} from 'lib-forwarding';
import {
  type CliPlacement,
  type DownloadPort,
  installCli,
  kill,
  nodeClientFiles,
  openCliControl,
  runStep,
  stopCli,
  type ScriptParameters,
  startCli,
  type StartOutcome,
} from 'lib-server';
import {startHost, type RunningHost} from './host-fixture.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';
import {dataFolderOf, lockLoop, parametersFor, scheduler} from './support.ts';

const ARCHIVE = process.env.REMOTE_OSS_CLI_ARCHIVE ?? '';

const ADDRESS = 'https://download.example.invalid/cli.tar.gz';

const NEVER_CANCELLED = new AbortController().signal;

/** How often and how many times the session end is polled: 10 s in all. */
const POLL_MILLISECONDS = 250;

const SESSION_END_POLLS = 40;

const TOKEN = 'cli-token-for-the-acceptance-test';

/** The one file of the CLI archive, which is the application name. */
function launcherOf(archive: string): string {
  const files = spawnSync('tar', ['-tzf', archive], {encoding: 'utf8'})
    .stdout.split('\n')
    .map(entry => entry.replace(/^\.\//, ''))
    .filter(entry => entry !== '' && !entry.endsWith('/'));
  return files.length === 1 ? (files[0] ?? '') : '';
}

describe('V7a the CLI on a real host', function () {
  this.timeout(180000);
  let host: RunningHost;
  let session: SharedSession;
  let parameters: ScriptParameters & {
    cli: NonNullable<ScriptParameters['cli']>;
  };
  let cliPath: string;
  const running: number[] = [];

  before(function () {
    if (ARCHIVE === '') {
      this.skip();
    }
  });

  before(async () => {
    host = await startHost();
    session = await openSharedSession(host);
    const launcher = launcherOf(ARCHIVE);
    const base = parametersFor();
    const name = `${launcher}-${base.commit}`;
    cliPath = `${dataFolderOf(base)}/${name}`;
    parameters = {
      ...base,
      launcher,
      archiveUrl: ADDRESS,
      archivePath: '',
      ['cli']: {name, dataFolder: `${dataFolderOf(base)}/cli`},
    };
  });

  afterEach(() => {
    for (const processId of running.splice(0)) {
      host.onHost('sh', '-c', `kill ${String(processId)} 2>/dev/null; true`);
    }
  });

  after(async () => {
    // Without an archive the rows are skipped before the host starts, and the hook has nothing to stop.
    if (ARCHIVE !== '') {
      await session.stop();
      host.stop();
    }
  });

  /** The CLI archive reaches the host by the client fallback: the "download" copies the local archive. */
  const download: DownloadPort = {
    download: request => {
      copyFileSync(ARCHIVE, request.destination);
      return Promise.resolve({
        kind: 'downloaded',
        facts: {},
        finalAddress: ADDRESS,
      });
    },
  };

  function placement(): CliPlacement {
    return {
      plan: {
        kind: 'cli',
        cliPath,
        cliDataFolder: `${dataFolderOf(parameters)}/cli`,
        download: true,
        where: 'client',
        clientFallback: false,
        dataFolder: dataFolderOf(parameters),
        lockPlace: `${dataFolderOf(parameters)}/bin/${parameters.commit}`,
        notes: [],
      },
      address: ADDRESS,
      redirect: {kind: 'any'},
      transfer: {
        clientFolder: process.env.TMPDIR ?? '/tmp',
        cache: {kind: 'none'},
        downloadBounds: {
          deadlineMilliseconds: 120_000,
          stallMilliseconds: 60_000,
          maximumBytes: 500_000_000,
        },
        temporaryToken: `cli-${String(process.pid)}`,
        verification: ['none'],
        hostFolder: '/tmp',
        discardDeadlineMilliseconds: 5000,
      },
    };
  }

  function install(): ReturnType<typeof installCli> {
    return installCli(
      parameters,
      placement(),
      {
        channel: host.channel,
        download,
        credentials: {readNetrc: () => Promise.resolve(undefined)},
        files: nodeClientFiles,
        lockLoop: lockLoop(),
        logger: createLogger(undefined, {minimumLevel: () => 'info'}),
        onPhase: () => undefined,
      },
      NEVER_CANCELLED,
    );
  }

  async function started(token = TOKEN): Promise<StartOutcome> {
    const outcome = await startCli(
      host.channel,
      parameters,
      token,
      {lockLoop: lockLoop()},
      NEVER_CANCELLED,
    );
    if (outcome.kind === 'started') {
      running.push(outcome.server.processId);
    }
    return outcome;
  }

  function portOf(outcome: StartOutcome): number {
    return outcome.kind === 'started' && outcome.server.endpoint.kind === 'port'
      ? outcome.server.endpoint.port
      : -1;
  }

  it('F-2103 POST-2: after installCli the host has the executable <data>/<applicationName>-<commit> and no cli-bin folder', async () => {
    const outcome = await install();
    deepStrictEqual(
      [
        outcome,
        host
          .onHost(
            'sh',
            '-c',
            `test -x '${cliPath}' && echo executable; ls '${dataFolderOf(parameters)}'`,
          )
          .split('\n')
          .filter(line => line === 'executable' || line === 'cli-bin'),
      ],
      [{kind: 'placed', path: cliPath}, ['executable']],
    );
  });

  it('F-2103 BR-8: a second installCli reports the same path and makes no staging folder', async () => {
    await install();
    host.onHost('rm', '-rf', `${dataFolderOf(parameters)}/cli-bin`);
    const again = await install();
    deepStrictEqual(
      [again, existsOnHost(`${dataFolderOf(parameters)}/cli-bin`)],
      [{kind: 'placed', path: cliPath}, false],
    );
  });

  function existsOnHost(file: string): boolean {
    return (
      host
        .onHost('sh', '-c', `test -e '${file}' && echo yes || echo no`)
        .trim() === 'yes'
    );
  }

  it('V7a: startCli reports a port that accepts a connection on the host', async () => {
    await install();
    const outcome = await started();
    deepStrictEqual(
      host
        .onHost(
          'sh',
          '-c',
          `nc -z 127.0.0.1 ${String(portOf(outcome))} && echo open || echo closed`,
        )
        .trim(),
      'open',
    );
  });

  it('§S10: while the CLI runs no line of ps -eo args on the host holds the token', async () => {
    await install();
    const outcome = await started();
    const lines = host.onHost('ps', '-o', 'args').split('\n');
    deepStrictEqual(
      [
        outcome.kind,
        lines.some(line => line.includes('command-shell')),
        lines.filter(line => line.includes(TOKEN)).length,
      ],
      ['started', true, 0],
    );
  });

  it("V7a: the CLI's log holds the Listening line with the reported port", async () => {
    await install();
    const outcome = await started();
    const logText = host.onHost(
      'cat',
      `${dataFolderOf(parameters)}/.cli.${parameters.commit}.log`,
    );
    deepStrictEqual(
      logText
        .split('\n')
        .includes(`Listening on 127.0.0.1:${String(portOf(outcome))}`),
      true,
    );
  });

  async function authenticated(port: number, token: string): Promise<string> {
    const stream = await socksDialer({
      local: nodeLocalPort(),
      socksPort: session.socksPort,
      scheduler,
      handshakeMilliseconds: 10000,
    }).dial({kind: 'port', port});
    const control = openCliControl(stream);
    const result = await control.authenticate(token);
    control.close();
    return result.kind;
  }

  it('V7a: the control client authenticates with the token', async () => {
    await install();
    const outcome = await started();
    deepStrictEqual(
      await authenticated(portOf(outcome), TOKEN),
      'authenticated',
    );
  });

  it('V7a: the control client with a wrong token is challengeRefused', async () => {
    await install();
    const outcome = await started();
    deepStrictEqual(
      await authenticated(portOf(outcome), 'not-the-token'),
      'challengeRefused',
    );
  });

  it('V7a: startCli over the shared session, then the session closed: within 10 s no command-shell is left on the host', async () => {
    await install();
    const sessionHost = await openSharedSession(host);
    const outcome = await startCli(
      sessionHost.channel,
      parameters,
      TOKEN,
      {lockLoop: lockLoop()},
      NEVER_CANCELLED,
    );
    const before = host.onHost('ps', '-o', 'args').includes('command-shell');
    await sessionHost.stop();
    let remaining = true;
    for (let attempt = 0; attempt < SESSION_END_POLLS && remaining; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_MILLISECONDS));
      remaining = host.onHost('ps', '-o', 'args').includes('command-shell');
    }
    deepStrictEqual(
      [outcome.kind, before, remaining],
      ['started', true, false],
    );
  });

  it('themis on #430: a start run with an empty environment is ServerFailedToStart with tokenMissing and starts no command-shell', async () => {
    await install();
    const stepRun = await runStep(
      host.channel,
      {installMode: 'singleScript', step: 'startCli'},
      parameters,
      {cancellation: NEVER_CANCELLED, environment: {}},
    );
    deepStrictEqual(
      [
        stepRun.kind === 'result'
          ? [stepRun.block.status, stepRun.block.cliFacts.tokenMissing]
          : stepRun.kind,
        host.onHost('ps', '-o', 'args').includes('command-shell'),
      ],
      [['ServerFailedToStart', 'yes'], false],
    );
  });

  it("themis on #458: stopCli with the CLI's process id leaves no command-shell on the host", async () => {
    await install();
    const outcome = await started();
    const stop = await stopCli(
      host.channel,
      parameters,
      outcome.kind === 'started' ? outcome.server.processId : -1,
      NEVER_CANCELLED,
    );
    let remaining = true;
    for (let attempt = 0; attempt < SESSION_END_POLLS && remaining; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_MILLISECONDS));
      remaining = host.onHost('ps', '-o', 'args').includes('command-shell');
    }
    deepStrictEqual([stop.kind, remaining], ['stopped', false]);
  });

  it('themis on #458: stopCli with the process id of another program leaves it running', async () => {
    await install();
    host.onHost(
      'sh',
      '-c',
      'nohup sleep 60 >/dev/null 2>&1 & echo $! > /tmp/foreign.pid',
    );
    const foreign = Number(host.onHost('cat', '/tmp/foreign.pid').trim());
    const stop = await stopCli(
      host.channel,
      parameters,
      foreign,
      NEVER_CANCELLED,
    );
    const alive =
      host
        .onHost('sh', '-c', `kill -0 ${String(foreign)} && echo yes || echo no`)
        .trim() === 'yes';
    host.onHost('sh', '-c', `kill ${String(foreign)} 2>/dev/null; true`);
    deepStrictEqual([stop.kind, alive], ['notRunning', true]);
  });

  it('themis on #458: stopCli with the process id of a program that only names the CLI file leaves it running', async () => {
    await install();
    const cliFile = cliPath;
    host.onHost(
      'sh',
      '-c',
      `nohup sh -c 'sleep 60; echo ${cliFile} command-shell' >/dev/null 2>&1 & echo $! > /tmp/mention.pid`,
    );
    const mention = Number(host.onHost('cat', '/tmp/mention.pid').trim());
    const stop = await stopCli(
      host.channel,
      parameters,
      mention,
      NEVER_CANCELLED,
    );
    const alive =
      host
        .onHost('sh', '-c', `kill -0 ${String(mention)} && echo yes || echo no`)
        .trim() === 'yes';
    host.onHost('sh', '-c', `kill ${String(mention)} 2>/dev/null; true`);
    deepStrictEqual([stop.kind, alive], ['notRunning', true]);
  });

  /** The commit and quality the CLI under test serves: its own, which `--version` prints. */
  function servedRelease(): {commit: string; quality: string} {
    const version = host.onHost(cliPath, '--version');
    return {
      commit: /\(commit ([0-9a-f]+)\)/.exec(version)?.[1] ?? '',
      quality: /^\S*-insiders?\b/.test(version) ? 'insider' : 'stable',
    };
  }

  /** Starts a CLI over `over` and serves the real server through it; the CLI's pid and what `serve` logged. */
  async function servedBy(over: SharedSession): Promise<{
    processId: number;
    served: string;
    lines: string[];
    connectionToken: string;
  }> {
    const outcome = await startCli(
      over.channel,
      parameters,
      TOKEN,
      {lockLoop: lockLoop()},
      NEVER_CANCELLED,
    );
    const processId =
      outcome.kind === 'started' ? outcome.server.processId : -1;
    const connectionToken =
      outcome.kind === 'started' ? outcome.server.connectionToken : '';
    running.push(processId);
    const stream = await socksDialer({
      local: nodeLocalPort(),
      socksPort: over.socksPort,
      scheduler,
      handshakeMilliseconds: 10000,
    }).dial({kind: 'port', port: portOf(outcome)});
    const control = openCliControl(stream);
    await control.authenticate(TOKEN);
    const lines: string[] = [];
    const served = await control.serve(
      {
        ...servedRelease(),
        connectionToken,
        useLocalDownload: false,
      },
      line => {
        lines.push(line.text);
      },
    );
    control.close();
    return {processId, served: served.kind, lines, connectionToken};
  }

  /** The host's processes whose arguments pass `test`. */
  function processes(test: (line: string) => boolean): string[] {
    return host
      .onHost('ps', '-o', 'pid,args')
      .split('\n')
      .filter(line => test(line));
  }

  function isServer(line: string): boolean {
    return line.includes('/server/node ');
  }

  function isSupervisor(line: string): boolean {
    return line.includes(' --cli-data-dir ') && !line.includes('command-shell');
  }

  it('athena on #412: stopping a CLI that served leaves the server it started running', async () => {
    await install();
    const session = await openSharedSession(host);
    const first = await servedBy(session);
    const stop = await stopCli(
      session.channel,
      parameters,
      first.processId,
      NEVER_CANCELLED,
    );
    await new Promise(resolve => setTimeout(resolve, 2000));
    const cliGone =
      host
        .onHost(
          'sh',
          '-c',
          `kill -0 ${String(first.processId)} 2>/dev/null && echo alive || echo gone`,
        )
        .trim() === 'gone';
    deepStrictEqual(
      [first.served, stop.kind, cliGone, processes(isServer).length > 0],
      ['serving', 'stopped', true, true],
    );
    await session.stop();
  });

  it("F-2103 BR-8: after a CLI was stopped, a new CLI's serve finds the running server", async () => {
    await install();
    const session = await openSharedSession(host);
    const first = await servedBy(session);
    await stopCli(
      session.channel,
      parameters,
      first.processId,
      NEVER_CANCELLED,
    );
    const second = await servedBy(session);
    deepStrictEqual(
      [
        second.served,
        second.lines.some(line => line.startsWith('Found running server')),
      ],
      ['serving', true],
    );
    await session.stop();
  });

  it('athena on #518: one agent-host supervisor serves two connects, and outlives both stops and the session', async () => {
    await install();
    const session = await openSharedSession(host);
    const first = await servedBy(session);
    const second = await servedBy(session);
    const duringBoth = processes(isSupervisor).length;
    for (const processId of [first.processId, second.processId]) {
      await stopCli(session.channel, parameters, processId, NEVER_CANCELLED);
    }
    await session.stop();
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual([duringBoth, processes(isSupervisor).length], [1, 1]);
  });

  it("F-2103 BR-8: two connects over one session are handed the host's one token, which the running server holds", async () => {
    await install();
    const session = await openSharedSession(host);
    const first = await servedBy(session);
    const second = await servedBy(session);
    const serverArguments = processes(isServer).join('\n');
    deepStrictEqual(
      [
        first.connectionToken !== '' &&
          first.connectionToken === second.connectionToken,
        serverArguments.includes(`--connection-token=${first.connectionToken}`),
      ],
      [true, true],
    );
    await session.stop();
  });

  it('contracts V7a: F-2409 BR-11, the token file stays, unchanged and private, after the CLIs stopped and the session ended', async () => {
    await install();
    const session = await openSharedSession(host);
    const first = await servedBy(session);
    await stopCli(
      session.channel,
      parameters,
      first.processId,
      NEVER_CANCELLED,
    );
    await session.stop();
    const tokenFile = `${dataFolderOf(parameters)}/cli/connection-token`;
    deepStrictEqual(
      [
        host.onHost('cat', tokenFile) === first.connectionToken,
        host.onHost('stat', '-c', '%a', tokenFile).trim(),
      ],
      [true, '600'],
    );
  });

  it('F-2411 AC-6: BR-3, BR-4, after a CLI served the real server, kill ends the server, leaves the CLI and its supervisor, and keeps cli/servers and the agent-host token of the CLI', async () => {
    await install();
    const first = await servedBy(session);
    const killed = await kill(session.channel, parameters, NEVER_CANCELLED);
    await new Promise(resolve => setTimeout(resolve, 2000));
    function kept(file: string): boolean {
      return (
        host
          .onHost('sh', '-c', `[ -e '${file}' ] && echo yes || echo no`)
          .trim() === 'yes'
      );
    }
    deepStrictEqual(
      [
        killed.kind,
        processes(isServer).length,
        processes(line => line.includes('command-shell')).length > 0,
        processes(isSupervisor).length,
        kept(`${dataFolderOf(parameters)}/cli/agent-host-token`),
        host
          .onHost('sh', '-c', `ls '${dataFolderOf(parameters)}/cli/servers'`)
          .trim() !== '',
      ],
      ['done', 0, true, 1, true, true],
    );
    running.push(first.processId);
  });
});
