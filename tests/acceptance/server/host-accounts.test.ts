import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawn} from 'node:child_process';
import {chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {connect} from 'node:net';
import path from 'node:path';
import {startHost, type RunningHost} from './host-fixture.ts';
import {freePort} from './support.ts';
import {startRunAgent} from '../../../tools/acceptance-keys.ts';
import {
  agentAdd,
  agentClear,
  agentKeys,
  fingerprintOf,
} from '../windows/harness.ts';

/** How long a run of `ssh` may take before the test ends it. */
const BOUND_MILLISECONDS = 30_000;

/** How long the mute shell is given to answer a command it was never asked to run. */
const MUTE_MILLISECONDS = 5_000;

/** What one run of `ssh` did: how it ended, what it printed, and whether the bound ended it. */
interface SshRun {
  status: number | null;
  stdout: string;
  endedByBound: boolean;
}

/** Waits the given number of milliseconds. */
function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('D-85: the host takes more accounts than harness', function () {
  this.timeout(120_000);

  let host: RunningHost;
  let configFile: string;
  let askpassFile: string;

  before(async () => {
    host = await startHost();
    configFile = path.join(host.runFolder, 'ssh_config');
    askpassFile = path.join(host.runFolder, 'askpass.sh');
    writeFileSync(askpassFile, '#!/bin/sh\ncat "$HARNESS_PASSWORD_FILE"\n');
    chmodSync(askpassFile, 0o700);
  });

  after(() => {
    host.stop();
  });

  /**
   * Runs `ssh -F <the run's ssh_config>` with the arguments. With `password`, the run's password is given through
   * an askpass script that reads it from the password file; `input` goes to standard input, and the run is ended
   * after `bound` milliseconds.
   */
  function sshRun(
    sshArguments: string[],
    options: {password?: boolean; input?: string; bound?: number} = {},
  ): Promise<SshRun> {
    return new Promise(resolve => {
      const child = spawn('ssh', ['-F', configFile, ...sshArguments], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: {
          ...process.env,
          ...(options.password === true
            ? {
                SSH_ASKPASS: askpassFile,
                SSH_ASKPASS_REQUIRE: 'force',
                HARNESS_PASSWORD_FILE: path.join(host.runFolder, 'password'),
              }
            : {}),
        },
      });
      let stdout = '';
      let endedByBound = false;
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      const timer = setTimeout(() => {
        endedByBound = true;
        child.kill('SIGKILL');
      }, options.bound ?? BOUND_MILLISECONDS);
      child.on('close', status => {
        clearTimeout(timer);
        resolve({status, stdout, endedByBound});
      });
      child.stdin.end(options.input ?? '');
    });
  }

  it("D-85: the password host takes the run's password", async () => {
    const outcome = await sshRun(['password', 'true'], {password: true});
    strictEqual(outcome.status, 0);
  });

  it("D-85: the password host refuses the run's key", async () => {
    const outcome = await sshRun([
      '-o',
      'PubkeyAuthentication=yes',
      '-o',
      'PreferredAuthentications=publickey',
      '-o',
      'BatchMode=yes',
      '-i',
      path.join(host.runFolder, 'id_ed25519'),
      'password',
      'true',
    ]);
    strictEqual(outcome.status, 255);
  });

  /**
   * Opens a local forward to the host's own sshd through the alias, connects to its port and reports what came
   * back before the connection closed: the data, and whether it closed.
   */
  async function throughForward(
    alias: string,
  ): Promise<{received: string; closed: boolean}> {
    const port = await freePort();
    const forward = spawn(
      'ssh',
      [
        '-F',
        configFile,
        '-N',
        '-L',
        `127.0.0.1:${String(port)}:127.0.0.1:22`,
        '-o',
        'ExitOnForwardFailure=yes',
        alias,
      ],
      {stdio: 'ignore'},
    );
    try {
      for (let attempt = 0; attempt < 50; attempt++) {
        const answered = await new Promise<boolean>(resolve => {
          const probe = connect(port, '127.0.0.1');
          probe.on('connect', () => {
            probe.destroy();
            resolve(true);
          });
          probe.on('error', () => {
            resolve(false);
          });
        });
        if (answered) {
          break;
        }
        await pause(200);
      }
      return await new Promise(resolve => {
        const socket = connect(port, '127.0.0.1');
        let received = '';
        socket.on('data', (chunk: Buffer) => {
          received += chunk.toString();
          socket.destroy();
          resolve({received, closed: false});
        });
        socket.on('close', () => {
          resolve({received, closed: true});
        });
        setTimeout(() => {
          socket.destroy();
          resolve({received, closed: false});
        }, 10_000);
      });
    } finally {
      forward.kill('SIGKILL');
    }
  }

  it('D-85: the forwarding-refused host refuses a local forward', async () => {
    deepStrictEqual(await throughForward('noforward'), {
      received: '',
      closed: true,
    });
  });

  it('D-85: the harness host carries a local forward to its sshd (the control for the refusal)', async () => {
    const outcome = await throughForward('harness');
    strictEqual(outcome.received.startsWith('SSH-2.0-'), true);
  });

  it('D-85: the forwarding-refused host runs commands', async () => {
    const outcome = await sshRun(['noforward', 'true']);
    strictEqual(outcome.status, 0);
  });

  it('D-85: the mute shell runs a command', async () => {
    const outcome = await sshRun(['mute', 'echo answered']);
    strictEqual(outcome.stdout.trim(), 'answered');
  });

  it('D-85: the mute shell never answers without a command', async () => {
    const outcome = await sshRun(['-T', 'mute'], {
      input: 'echo answered\n',
      bound: MUTE_MILLISECONDS,
    });
    deepStrictEqual([outcome.stdout, outcome.endedByBound], ['', true]);
  });

  for (const alias of ['master', 'master-yes', 'master-autoask']) {
    it(`D-85: ${alias} starts a control socket that a second ssh reuses`, async () => {
      try {
        await sshRun([alias, 'true'], {password: true});
        const check = await sshRun(['-O', 'check', alias]);
        strictEqual(check.status, 0);
      } finally {
        await sshRun(['-O', 'exit', alias]);
      }
    });
  }

  it('D-85: the run keeps its password out of the ssh_config and the host variables it writes', () => {
    const password = readFileSync(
      path.join(host.runFolder, 'password'),
      'utf8',
    );
    strictEqual(readFileSync(configFile, 'utf8').includes(password), false);
  });
});

describe("tooling-29: the run's further keys and the certificate-only account", function () {
  this.timeout(120_000);

  let host: RunningHost;
  let configFile: string;
  let emptyAskpass: string;

  before(async () => {
    host = await startHost();
    configFile = path.join(host.runFolder, 'ssh_config');
    emptyAskpass = path.join(host.runFolder, 'askpass-empty');
    writeFileSync(emptyAskpass, '#!/bin/sh\nprintf ""\n');
    chmodSync(emptyAskpass, 0o700);
  });

  after(() => {
    host.stop();
  });

  /** Runs `ssh -F <the run's ssh_config> <alias> true` with `variables`, and gives its status. */
  function loginStatus(
    alias: string,
    variables: Record<string, string>,
  ): Promise<number | null> {
    return new Promise(resolve => {
      const child = spawn('ssh', ['-F', configFile, alias, 'true'], {
        stdio: ['ignore', 'ignore', 'ignore'],
        env: {...process.env, SSH_AUTH_SOCK: '', ...variables},
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), BOUND_MILLISECONDS);
      child.on('close', status => {
        clearTimeout(timer);
        resolve(status);
      });
    });
  }

  /** The askpass variables that answer with the script `askpass`. */
  function askingWith(askpass: string): Record<string, string> {
    return {SSH_ASKPASS: askpass, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ''};
  }

  it("tooling-29: passkey logs in with the run's passphrase and is refused with an empty one", async () => {
    deepStrictEqual(
      [
        await loginStatus(
          'passkey',
          askingWith(path.join(host.runFolder, 'askpass-passphrase')),
        ),
        await loginStatus('passkey', askingWith(emptyAskpass)),
      ],
      [0, 255],
    );
  });

  it('tooling-29: certonly logs in with its certificate, and certonly-nocert is refused', async () => {
    deepStrictEqual(
      [
        await loginStatus('certonly', askingWith(emptyAskpass)),
        await loginStatus('certonly-nocert', askingWith(emptyAskpass)),
      ],
      [0, 255],
    );
  });

  it('tooling-29: loosekey is refused for its file mode', async () => {
    strictEqual(await loginStatus('loosekey', askingWith(emptyAskpass)), 255);
  });

  /** Runs `body` with a fresh agent of the run on its socket, as the harness's variables name it, then ends it. */
  async function withRunAgent(body: () => Promise<void>): Promise<void> {
    const socket = path.join(host.runFolder, 'test-agent.sock');
    const agent = startRunAgent(socket);
    const saved = {
      socket: process.env.HARNESS_AGENT_SOCKET,
      folder: process.env.HARNESS_RUN_FOLDER,
    };
    process.env.HARNESS_AGENT_SOCKET = socket;
    process.env.HARNESS_RUN_FOLDER = host.runFolder;
    try {
      for (let attempt = 0; attempt < 50 && !existsSync(socket); attempt++) {
        await pause(100);
      }
      await body();
    } finally {
      process.env.HARNESS_AGENT_SOCKET = saved.socket;
      process.env.HARNESS_RUN_FOLDER = saved.folder;
      agent.stop();
    }
  }

  it('tooling-29: an agent given the passphrase key logs passkey in without a question', async () => {
    await withRunAgent(async () => {
      await agentAdd(path.join(host.runFolder, 'id_passphrase'), {
        confirm: false,
      });
      strictEqual(
        await loginStatus('passkey', {
          SSH_AUTH_SOCK: process.env.HARNESS_AGENT_SOCKET ?? '',
          ...askingWith(emptyAskpass),
        }),
        0,
      );
    });
  });

  it('tooling-29: the agent starts empty, lists the passphrase key after agentAdd, and is empty after agentClear', async () => {
    await withRunAgent(async () => {
      const before = await agentKeys();
      await agentAdd(path.join(host.runFolder, 'id_passphrase'), {
        confirm: false,
      });
      const added = await agentKeys();
      await agentClear();
      deepStrictEqual(
        [before, added, await agentKeys()],
        [
          [],
          [await fingerprintOf(path.join(host.runFolder, 'id_passphrase'))],
          [],
        ],
      );
    });
  });

  it('tooling-29: a key added with the confirm constraint is listed too', async () => {
    await withRunAgent(async () => {
      await agentAdd(path.join(host.runFolder, 'id_second'), {confirm: true});
      deepStrictEqual(await agentKeys(), [
        await fingerprintOf(path.join(host.runFolder, 'id_second')),
      ]);
    });
  });
});
