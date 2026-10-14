import {deepStrictEqual} from 'node:assert';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {ChannelFailureKind, ScriptInput} from 'lib-host';
import {
  channelContractCases,
  type ChannelHarness,
  type ContractScenario,
} from 'lib-host/testing/channel-contract';
import type {EngineHost} from '../../../packages/remote-containers/src/engine/engine-host.ts';
import {nodeEngineHost} from '../../../packages/remote-containers/src/engine/node-engine-host.ts';
import {execChannelOf} from '../../../packages/remote-containers/src/exec/exec-channel.ts';
import {startHost, type RunningHost} from './host-fixture.ts';

const NEVER = new AbortController().signal;

/** A container that does not exist: `docker exec` answers with the daemon's own error. */
const MISSING_CONTAINER = 'no-such-container-for-the-exec-channel';

/** The digest the contract's script prints: the SHA-256 of what it reads. */
const DIGEST_SCRIPT = "sha256sum | cut -d' ' -f1";

/** A shell script that prints the lines and ends with `tail`. */
function printing(lines: readonly string[], tail: string): string {
  return [...lines.map(line => `printf '%s\\n' '${line}'`), tail].join('\n');
}

describe('the exec channel over a real container (card containers-02)', function () {
  this.timeout(120000);
  let host: RunningHost;
  let folder = '';
  const engine = nodeEngineHost('docker');

  before(async () => {
    host = await startHost();
    folder = mkdtempSync(path.join(tmpdir(), 'exec-channel-'));
    host.onHost('mkdir', '-p', '/tmp/exec-copy');
  });

  after(() => {
    rmSync(folder, {recursive: true, force: true});
    host.stop();
  });

  /** The engine whose first spawn names a container that does not exist, as a stopped one would fail. */
  function firstSpawnFails(inner: EngineHost): EngineHost {
    let first = true;
    return {
      // eslint-disable-next-line id-length -- the port's method is named run
      run: (argv, input, options) => inner.run(argv, input, options),
      spawn: (argv, options) => {
        if (!first) {
          return inner.spawn(argv, options);
        }
        first = false;
        return inner.spawn(
          argv.map(each =>
            each === host.container ? MISSING_CONTAINER : each,
          ),
          options,
        );
      },
    };
  }

  function localFile(content: Uint8Array): string {
    const file = path.join(folder, randomBytes(6).toString('hex'));
    writeFileSync(file, content);
    return file;
  }

  function inputFor(scenario: ContractScenario): ScriptInput {
    if (scenario.kind === 'missingInputFile') {
      return {kind: 'file', localFile: path.join(folder, 'missing')};
    }
    if (scenario.kind === 'digestsInput') {
      return scenario.input.kind === 'text'
        ? scenario.input
        : {kind: 'file', localFile: localFile(scenario.input.content)};
    }
    return scenario.kind === 'streamsUntilCancelled'
      ? {kind: 'file', localFile: localFile(new Uint8Array(4096))}
      : {kind: 'text', text: ''};
  }

  function scriptFor(scenario: ContractScenario): string {
    switch (scenario.kind) {
      case 'printsLines':
        return printing(scenario.lines, `exit ${String(scenario.status)}`);
      case 'printsUntilCancelled':
      case 'streamsUntilCancelled':
        return printing(scenario.lines, 'sleep 30');
      case 'digestsInput':
        return DIGEST_SCRIPT;
      default:
        return 'exit 0';
    }
  }

  /** The engine of a scenario: the real one, or one whose first spawn fails like a closed channel. */
  function engineFor(scenario: ContractScenario): EngineHost {
    if (
      (scenario.kind === 'scriptFails' || scenario.kind === 'copyFails') &&
      scenario.failure === 'channelClosed'
    ) {
      return firstSpawnFails(engine);
    }
    if (scenario.kind === 'failsThenSucceeds') {
      return firstSpawnFails(engine);
    }
    return scenario.kind === 'scriptFails' && scenario.failure === 'spawnFailed'
      ? nodeEngineHost('/nonexistent/docker')
      : engine;
  }

  const harness: ChannelHarness = {
    scriptFailures: ['channelClosed', 'spawnFailed'] as ChannelFailureKind[],
    copyFailures: ['copyFailed', 'channelClosed'] as ChannelFailureKind[],
    reachesClientFiles: false,
    stage: scenario => {
      const file = localFile(new Uint8Array(1024));
      const missingDirectory =
        scenario.kind === 'copyFails' && scenario.failure === 'copyFailed';
      return Promise.resolve({
        channel: execChannelOf(engineFor(scenario), host.container, 'harness'),
        script: {
          script: scriptFor(scenario),
          interpreter: 'posixShell',
          environment: {},
          input: inputFor(scenario),
        },
        copy: {
          localFile: file,
          remotePath: missingDirectory
            ? '/tmp/exec-copy/missing-directory/a.bin'
            : '/tmp/exec-copy/contract.bin',
        },
      });
    },
  };

  for (const contractCase of channelContractCases(harness)) {
    it(`contracts §1: ${contractCase.name}`, contractCase.check);
  }

  it('contracts §1: a copy of 5 MB arrives intact and owned by the user', async () => {
    const content = randomBytes(5 * 1024 * 1024);
    const file = localFile(content);
    const outcome = await execChannelOf(
      engine,
      host.container,
      'harness',
    ).copyToHost({
      localFile: file,
      remotePath: '/tmp/exec-copy/a.bin',
      cancellation: NEVER,
    });
    const digest = host
      .onHost('sha256sum', '/tmp/exec-copy/a.bin')
      .split(' ')[0];
    const owner = host
      .onHost('stat', '-c', '%U', '/tmp/exec-copy/a.bin')
      .trim();
    deepStrictEqual(
      [outcome, digest, owner],
      [
        {kind: 'copied'},
        createHash('sha256').update(content).digest('hex'),
        'harness',
      ],
    );
  });

  it('R-26: an environment value does not show in the arguments of any process on this machine while the script runs', async () => {
    const lines: string[] = [];
    const running = execChannelOf(engine, host.container, 'harness').runScript(
      {
        script: 'printf "%s\\n" "$SECRET_VALUE"; sleep 3',
        interpreter: 'posixShell',
        environment: {SECRET_VALUE: 'x y'},
        input: {kind: 'text', text: ''},
        cancellation: NEVER,
      },
      line => lines.push(line),
    );
    await new Promise(resolve => setTimeout(resolve, 1000));
    const processes = spawnSync('ps', ['-eo', 'args'], {
      encoding: 'utf8',
    }).stdout;
    const outcome = await running;
    deepStrictEqual(
      [
        lines,
        outcome,
        processes.split('\n').some(line => line.includes('x y')),
      ],
      [['x y'], {kind: 'exited', status: 0}, false],
    );
  });

  it('contracts §5: a script running in a container that is then stopped ends as channelClosed', async () => {
    const image = execFileSync(
      'docker',
      ['inspect', '--format', '{{.Config.Image}}', host.container],
      {encoding: 'utf8'},
    ).trim();
    const second = execFileSync(
      'docker',
      ['run', '-d', '--rm', '--entrypoint', 'sleep', image, '300'],
      {encoding: 'utf8'},
    ).trim();
    try {
      const running = execChannelOf(engine, second, 'harness').runScript(
        {
          script: 'sleep 30',
          interpreter: 'posixShell',
          environment: {},
          input: {kind: 'text', text: ''},
          cancellation: NEVER,
        },
        () => undefined,
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
      execFileSync('docker', ['stop', '-t', '0', second]);
      const outcome = await running;
      deepStrictEqual(
        outcome.kind === 'failed' ? outcome.failure.kind : outcome.kind,
        'channelClosed',
      );
    } finally {
      spawnSync('docker', ['rm', '-f', second]);
    }
  });
});
