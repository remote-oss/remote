import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {probe, runStep, startOrReuse, type StartOutcome} from 'lib-server';
import {createLogger} from 'lib-log';
import {startHost, type RunningHost} from './host-fixture.ts';
import {openSharedSession, type SharedSession} from './shared-session.ts';
import {
  dataFolderOf,
  lockLoop,
  parametersFor,
  placeStandInArchive,
} from './support.ts';

const CANCELLATION = new AbortController().signal;

describe('F-2102 the lifecycle through the one login of the shared ssh session', function () {
  this.timeout(180000);
  let host: RunningHost;
  let session: SharedSession;
  let loginsBefore: number;

  before(async () => {
    host = await startHost();
    placeStandInArchive(host);
    loginsBefore = host.logins();
    session = await openSharedSession(host);
  });

  after(async () => {
    await session.stop();
    host.stop();
  });

  function start(
    parameters: ReturnType<typeof parametersFor>,
  ): Promise<StartOutcome> {
    return startOrReuse(
      session.channel,
      parameters,
      {
        bindHost: '127.0.0.1',
        portRange: '',
        licenceAccepted: false,
        graceSeconds: 0,
        defaultExtensions: [],
        fileWatcherPollingMilliseconds: 0,
        readySeconds: 10,
      },
      [],
      {
        lockLoop: lockLoop(),
        logger: createLogger(undefined, {minimumLevel: () => 'info'}),
      },
      CANCELLATION,
    );
  }

  it('F-2102: probes, installs and starts the server over the session, with the one login of the session', async () => {
    const parameters = parametersFor();
    const probed = await probe(session.channel, parameters, CANCELLATION);
    const installed = await runStep(
      session.channel,
      {installMode: 'singleScript', step: 'install'},
      parameters,
      {cancellation: CANCELLATION},
    );
    const started = await start(parameters);
    deepStrictEqual(
      [
        probed.kind,
        installed.kind === 'result' ? installed.block.status : installed.kind,
        started.kind,
        host.logins() - loginsBefore,
      ],
      ['probed', 'Ok', 'started', 1],
    );
  });

  it('F-2104: the SOCKS forward rides the same session and accepts a connection', async () => {
    const accepted = await new Promise<boolean>(resolve => {
      const socket = createConnection(session.socksPort, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        resolve(false);
      });
    });
    deepStrictEqual(accepted, true);
  });

  it('F-2102: a text input arrives as its UTF-8 bytes', async () => {
    const outcome: string[] = [];
    const result = await session.channel.runScript(
      {
        script: "wc -c | tr -d ' '",
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'text', text: 'première ligne\n'},
        cancellation: CANCELLATION,
      },
      line => outcome.push(line),
    );
    deepStrictEqual([outcome, result], [['16'], {kind: 'exited', status: 0}]);
  });

  it('F-2102: a binary file input arrives byte for byte, every byte value included', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'shared-input-'));
    const localFile = path.join(folder, 'input');
    writeFileSync(
      localFile,
      Uint8Array.from([...[...Array(256).keys()], 0x0d, 0x0a, 0x00]),
    );
    const lines: string[] = [];
    await session.channel.runScript(
      {
        script: "wc -c | tr -d ' '",
        interpreter: 'posixShell',
        environment: {},
        input: {kind: 'file', localFile},
        cancellation: CANCELLATION,
      },
      line => lines.push(line),
    );
    rmSync(folder, {recursive: true, force: true});
    deepStrictEqual(lines, ['259']);
  });

  it('F-2102: runs the scripts of two callers one after the other on the session', async () => {
    const lines: string[] = [];
    const runs = ['one', 'two'].map(word =>
      session.channel.runScript(
        {
          script: `echo ${word}; sleep 0.2; echo ${word}`,
          interpreter: 'posixShell',
          environment: {},
          input: {kind: 'text', text: ''},
          cancellation: CANCELLATION,
        },
        line => lines.push(line),
      ),
    );
    await Promise.all(runs);
    deepStrictEqual(lines, ['one', 'one', 'two', 'two']);
  });

  it('F-2102: sees an environment variable of the run and the exit status of the script', async () => {
    const lines: string[] = [];
    const result = await session.channel.runScript(
      {
        script: 'echo "$GREETING"; exit 7',
        interpreter: 'posixShell',
        environment: {GREETING: "it's here"},
        input: {kind: 'text', text: ''},
        cancellation: CANCELLATION,
      },
      line => lines.push(line),
    );
    deepStrictEqual(
      [lines, result],
      [["it's here"], {kind: 'exited', status: 7}],
    );
  });

  it('F-2411: a kill through the same session stops the server it started', async () => {
    const parameters = parametersFor();
    await runStep(
      session.channel,
      {installMode: 'singleScript', step: 'install'},
      parameters,
      {cancellation: CANCELLATION},
    );
    await start(parameters);
    await runStep(
      session.channel,
      {installMode: 'singleScript', step: 'kill'},
      parameters,
      {cancellation: CANCELLATION},
    );
    deepStrictEqual(
      host
        .onHost(
          'sh',
          '-c',
          `ls '${dataFolderOf(parameters)}' | grep -c bin || true`,
        )
        .trim(),
      '0',
    );
  });
});
