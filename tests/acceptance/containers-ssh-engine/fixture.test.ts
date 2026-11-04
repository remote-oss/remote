/**
 * @fileoverview The SSH Docker host and the run's client, as the rows of the SSH engine cards use them (card
 * tooling-123): each account logs in its one way, the host key is known or not as a row chooses, the stand-in asks
 * with an empty question, the closed port refuses, and a quick input loses focus.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {chmodSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  dockerWith,
  SSH_DEAD,
  sshClientEnvironment,
  sshEngine,
  type EngineAccount,
  type SshEngine,
  sshStandIn,
} from '../windows/engine-fixture.ts';
import {
  moveFocusAway,
  startInWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {inputBoxOf} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

/** What `ssh` through the run's client prints, or the last line of what it refused with. */
async function loggedIn(
  engine: SshEngine,
  account: EngineAccount,
  answers: Readonly<Record<string, string>> = {},
): Promise<string> {
  const {port} = new URL(engine.address(account));
  try {
    const {stdout} = await execFileAsync(
      'ssh',
      [
        ...(Object.keys(answers).length === 0 ? ['-o', 'BatchMode=yes'] : []),
        '-p',
        port,
        `${account}@127.0.0.1`,
        'id -un',
      ],
      {env: {...process.env, ...sshClientEnvironment(), ...answers}},
    );
    return stdout.trim();
  } catch (error) {
    const {stderr = ''} = error as {stderr?: string};
    return stderr.trim().split('\n').pop() ?? '';
  }
}

/** What `docker info` over the stand-in prints with the askpass `answers`: the daemon's OS type, `refused` or `other`. */
async function standInAnswer(
  remote: Readonly<Record<string, string>>,
  answers: Readonly<Record<string, string>>,
): Promise<string> {
  return dockerWith(
    {...remote, ...answers},
    'info',
    '--format',
    '{{.OSType}}',
  ).then(
    printed => printed,
    (error: unknown) =>
      ((error as {stderr?: string}).stderr ?? '').includes(
        'Permission denied (password).',
      )
        ? 'refused'
        : 'other',
  );
}

/** Everything `ssh` through the run's client printed on refusing `account` in batch mode. */
async function refusedWith(
  engine: SshEngine,
  account: EngineAccount,
): Promise<string> {
  const {port} = new URL(engine.address(account));
  return execFileAsync(
    'ssh',
    ['-o', 'BatchMode=yes', '-p', port, `${account}@127.0.0.1`, 'true'],
    {env: {...process.env, ...sshClientEnvironment()}},
  ).then(
    () => '',
    (error: unknown) => (error as {stderr?: string}).stderr ?? '',
  );
}

describe('the SSH Docker host and the run’s client (card tooling-123)', function () {
  this.timeout(600_000);
  let engine: SshEngine;
  let scripts: string;

  /** An askpass that prints `answer`, in this suite's folder. */
  function askpass(answer: string): Record<string, string> {
    const file = path.join(scripts, `askpass-${String(answer.length)}`);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${answer}'\n`);
    chmodSync(file, 0o755);
    return {SSH_ASKPASS: file, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: ''};
  }

  before(async () => {
    scripts = mkdtempSync(path.join(tmpdir(), 'c205-askpass-'));
    engine = await sshEngine({password: 'pw-one'});
  });

  after(async () => {
    await engine.stop();
    rmSync(scripts, {recursive: true, force: true});
  });

  it('tooling-123 (engine-accounts): engine takes the run’s key, engine-pw a password only, engine-enc the passphrase key only, engine-refused nothing, and engine-tries gives up after two tries', async () => {
    const passphraseScript = path.join(scripts, 'askpass-passphrase');
    writeFileSync(
      passphraseScript,
      `#!/bin/sh\ncat '${variable('HARNESS_PASSPHRASE_FILE')}'\n`,
    );
    chmodSync(passphraseScript, 0o755);
    deepStrictEqual(
      {
        engine: await loggedIn(engine, 'engine'),
        pwByKey: await loggedIn(engine, 'engine-pw'),
        pwByPassword: await loggedIn(engine, 'engine-pw', askpass('pw-one')),
        passphraseKey: await loggedIn(engine, 'engine-enc', {
          SSH_ASKPASS: passphraseScript,
          SSH_ASKPASS_REQUIRE: 'force',
          DISPLAY: '',
        }),
        refused: await loggedIn(engine, 'engine-refused'),
        tries: (await refusedWith(engine, 'engine-tries')).includes(
          'Too many authentication failures',
        ),
        daemon: await dockerWith(
          {...sshClientEnvironment(), DOCKER_HOST: engine.address('engine')},
          'info',
          '--format',
          '{{.OSType}}',
        ),
      },
      {
        engine: 'engine',
        pwByKey: 'engine-pw@127.0.0.1: Permission denied (password).',
        pwByPassword: 'engine-pw',
        passphraseKey: 'engine-enc',
        refused: 'engine-refused@127.0.0.1: Permission denied (publickey).',
        tries: true,
        daemon: 'linux',
      },
    );
  });

  it('tooling-123 (host-key-modes): with the host key unknown the run’s client refuses the host, and known again it logs in', async () => {
    engine.trustHostKey(false);
    const unknown = [engine.hostKeyKnown(), await loggedIn(engine, 'engine')];
    engine.trustHostKey(true);
    deepStrictEqual(
      {
        unknown,
        known: [engine.hostKeyKnown(), await loggedIn(engine, 'engine')],
      },
      {
        unknown: [false, 'Host key verification failed.'],
        known: [true, 'engine'],
      },
    );
  });

  it('tooling-123 (stand-in-and-closed-port): the stand-in asks an empty question and lets the right answer through, refuses another, and the closed port refuses the connection', async () => {
    const remote = {
      ...sshClientEnvironment(),
      DOCKER_HOST: engine.address('engine'),
    };
    const restore = await sshStandIn('let-me-in');
    const [right, wrong] = await (async () => [
      await standInAnswer(remote, askpass('let-me-in')),
      await standInAnswer(remote, askpass('no')),
    ])().finally(restore);
    const closed = await dockerWith(
      {...sshClientEnvironment(), DOCKER_HOST: SSH_DEAD},
      'info',
    ).then(
      () => 'answered',
      () => 'refused',
    );
    deepStrictEqual(
      {right, wrong, closed},
      {right: 'linux', wrong: 'refused', closed: 'refused'},
    );
  });

  it('tooling-123 (focus-away): a quick input open in the window closes when its focus moves to the editor', async () => {
    await startInWindow('local', 'workbench.action.showCommands');
    const open = await waitFor(
      'the Command Palette',
      async () => (await inputBoxOf('local')) !== undefined,
      30_000,
    ).then(
      () => true,
      () => false,
    );
    await moveFocusAway('local');
    await new Promise(resolve => setTimeout(resolve, 1000));
    deepStrictEqual(
      {open, closed: (await inputBoxOf('local')) === undefined},
      {open: true, closed: true},
    );
  });
});
