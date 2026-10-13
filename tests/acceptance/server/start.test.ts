import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {
  type RuntimeOptions,
  type ScriptParameters,
  type StartOutcome,
  runStep,
  startOrReuse,
} from 'lib-server';
import {startHost, type RunningHost} from './host-fixture.ts';
import {OPTION_LINE_PREFIX, type StandInBehaviour} from './stand-in-server.ts';
import {
  dataFolderOf,
  hostArchiveOf,
  installStatus,
  lockLoop,
  parametersFor,
  placeStandInArchive,
  portOfStarted,
} from './support.ts';

const SILENT = createLogger(undefined, {minimumLevel: () => 'info'});

const OPTIONS: RuntimeOptions = {
  bindHost: '127.0.0.1',
  portRange: '',
  licenceAccepted: false,
  graceSeconds: 0,
  defaultExtensions: [],
  fileWatcherPollingMilliseconds: 0,
  readySeconds: 10,
  socketMode: false,
};

/** The outcome of a start that found the server of `outcome` already running. */
function asReused(outcome: StartOutcome): StartOutcome {
  return outcome.kind === 'started'
    ? {...outcome, server: {...outcome.server, reused: true}}
    : outcome;
}

describe('F-2409 the start of the server', function () {
  this.timeout(120000);
  let host: RunningHost;

  before(async () => {
    host = await startHost();
    placeStandInArchive(host);
    placeStandInArchive(host, 'listening');
    placeStandInArchive(host, 'crashing');
    placeStandInArchive(host, 'missingLibraries');
    placeStandInArchive(host, 'silent');
    placeStandInArchive(host, 'readyThenExit');
    placeStandInArchive(host, 'noFreePort');
    placeStandInArchive(host, 'cveTerminated');
  });

  after(() => {
    host.stop();
  });

  async function installed(
    behaviour: StandInBehaviour = 'serving',
  ): Promise<ScriptParameters> {
    const parameters = parametersFor({archivePath: hostArchiveOf(behaviour)});
    await installStatus(host, parameters);
    return parameters;
  }

  function start(
    parameters: ScriptParameters,
    changes: Partial<RuntimeOptions> = {},
  ): Promise<StartOutcome> {
    return startOrReuse(
      host.channel,
      parameters,
      {...OPTIONS, ...changes},
      [],
      {lockLoop: lockLoop(), logger: SILENT},
      new AbortController().signal,
    );
  }

  /** The parameters and port of a started `listening` stand-in, each row with its own. */
  async function listening(): Promise<{
    parameters: ScriptParameters;
    port: number;
  }> {
    const parameters = await installed('listening');
    const outcome = await start(parameters);
    if (outcome.kind !== 'started') {
      throw new Error('the listening stand-in did not start');
    }
    return {parameters, port: portOfStarted(outcome.server)};
  }

  /** The options the stand-in server was started with, from its log. */
  function optionsOf(parameters: ScriptParameters): string[] {
    return host
      .onHost('cat', `${dataFolderOf(parameters)}/.${parameters.commit}.log`)
      .split('\n')
      .filter(line => line.startsWith(OPTION_LINE_PREFIX))
      .map(line => line.slice(OPTION_LINE_PREFIX.length));
  }

  it('contracts V7: starts the server and reads its port from the ready line', async () => {
    const outcome = await start(await installed(), {portRange: '30000-30010'});
    deepStrictEqual(
      outcome.kind === 'started' ? portOfStarted(outcome.server) : outcome,
      30000,
    );
  });

  it('contracts V7: picks a free port when the range is empty', async () => {
    const outcome = await start(await installed());
    deepStrictEqual(
      outcome.kind === 'started' &&
        portOfStarted(outcome.server) >= 20000 &&
        portOfStarted(outcome.server) < 40000,
      true,
    );
  });

  it('contracts V7: gives a connection token of 32 letters and digits, kept in a file only the user reads', async () => {
    const parameters = await installed();
    const outcome = await start(parameters);
    const tokenFile = `${dataFolderOf(parameters)}/.${parameters.commit}.token`;
    deepStrictEqual(
      [
        outcome.kind === 'started'
          ? /^[A-Za-z0-9]{32}$/.test(outcome.server.connectionToken)
          : outcome,
        host.onHost('stat', '-c', '%a', tokenFile).trim(),
      ],
      [true, '600'],
    );
  });

  it('contracts V7: passes the options of the contract, telemetry off, and no licence flag before acceptance', async () => {
    const parameters = await installed();
    await start(parameters);
    deepStrictEqual(optionsOf(parameters), [
      '--start-server',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--connection-token-file',
      `${dataFolderOf(parameters)}/.${parameters.commit}.token`,
      '--telemetry-level',
      'off',
      '--enable-remote-auto-shutdown',
    ]);
  });

  it('contracts V7: adds the licence flag once the user accepted the terms', async () => {
    const parameters = await installed();
    await start(parameters, {licenceAccepted: true});
    deepStrictEqual(
      optionsOf(parameters).at(-1),
      '--accept-server-license-terms',
    );
  });

  it('contracts V7: replaces a bind host it rejects with the loopback address, and says so', async () => {
    const parameters = await installed();
    const outcome = await start(parameters, {bindHost: '-bad'});
    deepStrictEqual(
      [
        outcome.kind === 'started' ? outcome.notices : outcome,
        optionsOf(parameters).slice(1, 3),
      ],
      [
        [{kind: 'bindHostRejected', configured: '-bad'}],
        ['--host', '127.0.0.1'],
      ],
    );
  });

  it('contracts V7: reuses the server that runs instead of starting another', async () => {
    const parameters = await installed();
    const first = await start(parameters);
    const second = await start(parameters);
    deepStrictEqual(second, asReused(first));
  });

  it('contracts V7: refuses a reversed port range before it asks the host anything', async () => {
    const parameters = await installed();
    deepStrictEqual(await start(parameters, {portRange: '9000-8000'}), {
      kind: 'failed',
      failure: {kind: 'invalidPortRange'},
    });
  });

  it('contracts V7: fails to start when no server is installed', async () => {
    deepStrictEqual(await start(parametersFor()), {
      kind: 'failed',
      failure: {kind: 'serverStart'},
    });
  });

  it('contracts V7: reports a server that exits at once as a failed start', async () => {
    deepStrictEqual(
      await start(await installed('crashing'), {readySeconds: 2}),
      {kind: 'failed', failure: {kind: 'serverStart'}},
    );
  });

  it('contracts V7: F-2409 BR-10, a server that exits before reporting a port fails at the end of the wait', async () => {
    const parameters = await installed('crashing');
    const began = Date.now();
    await start(parameters, {readySeconds: 2});
    deepStrictEqual(Date.now() - began >= 2000, true);
  });

  it('contracts V7: F-2401, a server that exits with 207 fails at once', async () => {
    const parameters = await installed('missingLibraries');
    const began = Date.now();
    await start(parameters, {readySeconds: 10});
    deepStrictEqual(Date.now() - began < 1000, true);
  });

  it('contracts V7: F-2409 BR-10, a port written before the exit still counts', async () => {
    const outcome = await start(await installed('readyThenExit'), {
      readySeconds: 2,
    });
    deepStrictEqual(
      outcome.kind === 'started' ? portOfStarted(outcome.server) : outcome,
      24680,
    );
  });

  it('contracts V7: F-2409 6.2, a server with no free port in its range fails with that cause', async () => {
    deepStrictEqual(
      await start(await installed('noFreePort'), {
        portRange: '1-2',
        readySeconds: 2,
      }),
      {kind: 'failed', failure: {kind: 'serverStart', cause: 'noFreePort'}},
    );
  });

  it('F-2409 AC-30: a server that ended for CVE-2020-1416 fails at once with that cause', async () => {
    const parameters = await installed('cveTerminated');
    const began = Date.now();
    const outcome = await start(parameters, {readySeconds: 10});
    deepStrictEqual(
      [outcome, Date.now() - began < 1000],
      [
        {
          kind: 'failed',
          failure: {kind: 'serverStart', cause: 'cveTerminated'},
        },
        true,
      ],
    );
  });

  it('contracts V7: reports a server that lacks libraries on the host as missing prerequisites', async () => {
    deepStrictEqual(await start(await installed('missingLibraries')), {
      kind: 'failed',
      failure: {kind: 'prerequisitesMissing'},
    });
  });

  it('contracts V7: gives up on a server that never reports a port, after the time it was given', async () => {
    deepStrictEqual(await start(await installed('silent'), {readySeconds: 2}), {
      kind: 'failed',
      failure: {kind: 'serverStart'},
    });
  });

  it('#140 part F: the listening stand-in reports a port from the free range', async () => {
    const {port} = await listening();
    deepStrictEqual(port >= 20000 && port < 40000, true);
  });

  it('#140 part F: a connection to its port echoes what it sends', async () => {
    const {port} = await listening();
    deepStrictEqual(
      host
        .onHost(
          'sh',
          '-c',
          `printf 'ping\\n' | nc -w 2 127.0.0.1 ${String(port)}`,
        )
        .trim(),
      'ping',
    );
  });

  it('#140 part F: the listener still echoes after a connection closed', async () => {
    const {port} = await listening();
    function echo(): string {
      return host
        .onHost(
          'sh',
          '-c',
          `printf 'ping\\n' | nc -w 2 127.0.0.1 ${String(port)}`,
        )
        .trim();
    }
    deepStrictEqual([echo(), echo()], ['ping', 'ping']);
  });

  it('contracts §S9: a kill leaves nothing listening on the stand-in port', async () => {
    const {parameters, port} = await listening();
    await runStep(
      host.channel,
      {installMode: 'singleScript', step: 'kill'},
      parameters,
      {cancellation: new AbortController().signal},
    );
    // The kill returns once it has signalled the server; the listener may take a moment more to end.
    function answers(): boolean {
      return (
        host
          .onHost(
            'sh',
            '-c',
            `nc -w 1 127.0.0.1 ${String(port)} </dev/null >/dev/null 2>&1 && echo yes || echo no`,
          )
          .trim() === 'yes'
      );
    }
    for (let attempt = 0; attempt < 20 && answers(); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    deepStrictEqual(answers(), false);
  });
});
