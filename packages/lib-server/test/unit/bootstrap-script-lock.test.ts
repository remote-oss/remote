/**
 * @fileoverview The POSIX bootstrap script's rows for a server that is already there, and the lock, run for real over stand-in tools.
 */

import {deepStrictEqual} from 'node:assert';
import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  symlinkSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {scriptFor, type ScriptParameters} from '../../src/index.ts';
import {
  blockOf,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
} from './fake-host.ts';
import {
  holdLinkLock,
  installHostHooks,
  lockInTemporaryFolder,
  serverFactsOf,
  statusAndFacts,
  statusOf,
} from './bootstrap-script.fixture.ts';

describe('the POSIX bootstrap script', () => {
  let host: FakeHost;
  const useHost = installHostHooks(made => {
    host = made;
  });

  describe('a server that is already there, and the lock', function () {
    this.timeout(60_000);

    function dataFolder(): string {
      return path.join(host.home, '.server-data');
    }

    const children: ChildProcess[] = [];

    afterEach(() => {
      for (const child of children.splice(0)) {
        child.kill('SIGKILL');
      }
    });

    /** Starts a process that outlives the call, and returns it. */
    function background(
      command: string,
      commandArguments: readonly string[],
      environment: Record<string, string>,
      logFile?: string,
    ): ChildProcess {
      const output = logFile === undefined ? 'ignore' : openSync(logFile, 'w');
      const child = spawn(command, commandArguments, {
        env: {...host.environment, ...environment},
        stdio: ['ignore', output, output],
        detached: true,
      });
      if (typeof output === 'number') {
        closeSync(output);
      }
      children.push(child);
      return child;
    }

    function startedCount(): number {
      const file = host.environment.SERVER_STARTS ?? '';
      return existsSync(file)
        ? readFileSync(file, 'utf8').trim().split('\n').length
        : 0;
    }

    /** A server of an earlier start that is still on its way to ready: its pid, log and token are recorded. */
    function installWithSlowServer(): void {
      runScript(host, single('install'), parametersFor());
      const slow = background(
        path.join(installFolder(host), 'bin', 'launcher'),
        [],
        {SERVER_READY_AFTER: '2'},
        path.join(dataFolder(), '.abc123.log'),
      );
      writeFileSync(
        path.join(dataFolder(), '.abc123.pid'),
        `${String(slow.pid)}\n`,
      );
      writeFileSync(
        path.join(dataFolder(), '.abc123.token'),
        'token-of-the-first-start',
      );
    }

    it('F-2409.BR-8: a recorded pid that is not the server is not taken for it', () => {
      runScript(host, single('install'), parametersFor());
      const stranger = background('/bin/sleep', ['300'], {});
      writeFileSync(
        path.join(dataFolder(), '.abc123.pid'),
        `${String(stranger.pid)}\n`,
      );
      writeFileSync(
        path.join(dataFolder(), '.abc123.log'),
        'Extension host agent listening on 4242\n',
      );
      deepStrictEqual(
        statusAndFacts(host, single('start'), parametersFor(), ['server.port']),
        {status: 'Ok', 'server.port': '4321'},
      );
    });

    it('F-2409.BR-8: a start never answers with an empty connection token', () => {
      runScript(host, single('install'), parametersFor());
      runScript(host, single('start'), parametersFor());
      const block = blockOf(host, single('start'), parametersFor());
      deepStrictEqual(
        block === 'none' ? '' : (block.serverFacts.token ?? '').length > 0,
        true,
      );
    });

    it('F-2409.BR-8: a server that is still starting is waited for, not started a second time', () => {
      installWithSlowServer();
      const parameters = parametersFor();
      parameters.start.readySeconds = 8;
      runScript(host, single('start'), parameters);
      deepStrictEqual(startedCount(), 1);
    });

    it('F-2409.BR-8: a server that is still starting becomes the answer once it is ready', () => {
      installWithSlowServer();
      const parameters = parametersFor();
      parameters.start.readySeconds = 8;
      deepStrictEqual(
        statusAndFacts(host, single('start'), parameters, ['server.port']),
        {status: 'Ok', 'server.port': '4321'},
      );
    });

    it('#668 R1: a start whose token file cannot be written is a write failure naming it', () => {
      runScript(host, single('install'), parametersFor());
      chmodSync(dataFolder(), 0o555);
      const facts = serverFactsOf(host, single('start'), parametersFor());
      chmodSync(dataFolder(), 0o755);
      deepStrictEqual(
        facts.writeFailedPath,
        path.join(dataFolder(), '.abc123.token'),
      );
    });

    it('F-2408.BR-3: a start waits on the host lock another window holds', () => {
      runScript(host, single('install'), parametersFor());
      holdLinkLock(host);
      deepStrictEqual(
        statusOf(host, single('start'), parametersFor()),
        'LockBusy',
      );
    });

    for (const shell of ['/bin/sh', '/bin/dash']) {
      for (const method of ['flock', 'link'] as const) {
        it(`#668 R3: a lock that cannot be opened is a write failure naming the lock file under ${shell}, by ${method}`, () => {
          useHost(['wget', 'flock']);
          mkdirSync(installFolder(host), {recursive: true});
          chmodSync(installFolder(host), 0o555);
          const parameters = parametersFor();
          parameters.lock.method = method;
          const block = blockOf(host, single('install'), parameters, {shell});
          chmodSync(installFolder(host), 0o755);
          deepStrictEqual(
            block === 'none'
              ? block
              : [
                  block.status,
                  block.serverFacts.writeFailedPath,
                  (block.serverFacts.writeFailedError ?? '') !== '',
                ],
            [
              'CreateInstallDirFailed',
              path.join(installFolder(host), 'boot-lock.user.abc123'),
              true,
            ],
          );
        });
      }
    }

    it('#668 R3: a lock path that is a directory in a writable install folder is a write failure naming the lock path', () => {
      const lock = path.join(installFolder(host), 'boot-lock.user.abc123');
      mkdirSync(lock, {recursive: true});
      const facts = serverFactsOf(host, single('install'), parametersFor());
      deepStrictEqual(
        [
          facts.writeFailedPath,
          (facts.writeFailedError ?? '') !== '',
          facts.lockPath,
          facts.lockInTemporary,
        ],
        [lock, true, lock, 'no'],
      );
    });

    it('#668 R3: the same install with the lock in the temporary folder goes through', () => {
      mkdirSync(path.join(installFolder(host), 'boot-lock.user.abc123'), {
        recursive: true,
      });
      const parameters = parametersFor();
      lockInTemporaryFolder(host, parameters);
      deepStrictEqual(statusOf(host, single('install'), parameters), 'Ok');
    });

    it('#668 R1: an install folder that cannot be made is a write failure naming it', () => {
      mkdirSync(path.join(host.home, '.server-data', 'bin'), {recursive: true});
      chmodSync(path.join(host.home, '.server-data', 'bin'), 0o555);
      const facts = serverFactsOf(host, single('install'), parametersFor());
      chmodSync(path.join(host.home, '.server-data', 'bin'), 0o755);
      deepStrictEqual(
        [
          facts.writeFailedPath,
          (facts.writeFailedError ?? '') !== '',
          facts.lockPath,
          facts.lockInTemporary,
        ],
        [installFolder(host), true, undefined, undefined],
      );
    });

    it('#668 R4: a link lock held by another window reports the lock file', () => {
      const lock = holdLinkLock(host);
      deepStrictEqual(
        serverFactsOf(host, single('install'), parametersFor()).lockPath,
        lock,
      );
    });

    /** Runs an install whose /tmp lock is a symlink to a file that must stay as it is. */
    function installOverSymlinkedLock(): {
      status: string;
      facts: Record<string, string>;
      victim: string;
    } {
      const victim = path.join(path.dirname(host.callsFile), 'victim.txt');
      writeFileSync(victim, 'keep me');
      const parameters = parametersFor();
      const link = lockInTemporaryFolder(host, parameters);
      symlinkSync(victim, link);
      const block = blockOf(host, single('install'), parameters);
      unlinkSync(link);
      return {
        status: block === 'none' ? block : block.status,
        facts: block === 'none' ? {} : block.serverFacts,
        victim,
      };
    }

    /** Starts an install whose download takes a while, interrupts the shell with `signal`, and waits for it to end. */
    async function installInterruptedBy(
      signal: NodeJS.Signals,
      shellProgram: string,
    ): Promise<void> {
      const shell = spawn(shellProgram, ['-s'], {
        env: {...host.environment, STUB_FETCH_SLEEP: '2'},
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      shell.stdin.end(
        scriptFor(single('install'), 'posixShell', parametersFor()),
      );
      const lock = path.join(
        installFolder(host),
        'boot-lock.user.abc123.target',
      );
      for (let wait = 0; wait < 50 && !existsSync(lock); wait++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      shell.kill(signal);
      await new Promise(resolve => shell.once('exit', resolve));
    }

    for (const shellProgram of ['/bin/sh', '/bin/dash']) {
      for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
        it(`F-2408.BR-4: an install interrupted by ${signal} under ${shellProgram} does not leave its link lock behind`, async () => {
          await installInterruptedBy(signal, shellProgram);
          deepStrictEqual(
            existsSync(
              path.join(installFolder(host), 'boot-lock.user.abc123.target'),
            ),
            false,
          );
        });
      }
    }

    it('F-2408.BR-4: a lock another window holds is not released by an install that gave up on it', () => {
      const lock = holdLinkLock(host);
      runScript(host, single('install'), parametersFor());
      deepStrictEqual(existsSync(`${lock}.target`), true);
    });

    it('#668 R3: a lock in the temporary folder that is a symlink is refused as not a regular file', () => {
      const outcome = installOverSymlinkedLock();
      deepStrictEqual(
        [outcome.status, outcome.facts.writeFailedError],
        ['CreateInstallDirFailed', 'not a regular file'],
      );
    });

    it('F-2408.BR-2: a lock in the temporary folder that is a symlink leaves its target alone', () => {
      const outcome = installOverSymlinkedLock();
      deepStrictEqual(readFileSync(outcome.victim, 'utf8'), 'keep me');
    });

    it('F-2411.BR-3: kill leaves a process alone whose pid is only recorded', () => {
      runScript(host, single('install'), parametersFor());
      const marker = path.join(path.dirname(host.callsFile), 'got-signal');
      const stranger = background(
        '/bin/sh',
        [
          '-c',
          `trap 'echo got >"${marker}"; exit 0' TERM; while :; do sleep 1; done`,
        ],
        {},
      );
      spawnSync('/bin/sleep', ['0.5']);
      writeFileSync(
        path.join(dataFolder(), '.abc123.pid'),
        `${String(stranger.pid)}\n`,
      );
      runScript(host, single('kill'), parametersFor());
      spawnSync('/bin/sleep', ['1.5']);
      deepStrictEqual(existsSync(marker), false);
    });

    /** The marker file a process writes when it is sent TERM. */
    function markerOf(name: string): string {
      return path.join(path.dirname(host.callsFile), `got-signal-${name}`);
    }

    /** The script of a process that records the TERM it gets and otherwise waits. */
    function trapScript(marker: string): string {
      return `trap 'echo got >"${marker}"; exit 0' TERM; while :; do sleep 1; done`;
    }

    /** Starts a shell as `program` with these arguments after its script; returns the marker its TERM writes. */
    function started(
      name: string,
      program: string,
      commandArguments: readonly string[] = [],
    ): string {
      const marker = markerOf(name);
      const child = spawn(
        '/bin/sh',
        ['-c', trapScript(marker), ...commandArguments],
        {
          env: host.environment,
          stdio: 'ignore',
          detached: true,
          argv0: program,
        },
      );
      children.push(child);
      return marker;
    }

    /** The launcher's script, under cli/servers/, as the server's own is. */
    function launcherScript(): string {
      return path.join(
        dataFolder(),
        'cli',
        'servers',
        'Stable-abc123',
        'server',
        'bin',
        'launcher',
      );
    }

    /**
     * Starts `script` with a shell, named `program` in the command line, so that the script is its argv[1]; the script
     * records the TERM it gets. Returns the marker.
     */
    function startedScript(
      name: string,
      program: string,
      script: string,
    ): string {
      const marker = markerOf(name);
      mkdirSync(path.dirname(script), {recursive: true});
      writeFileSync(script, trapScript(marker));
      children.push(
        spawn('/bin/sh', [script], {
          env: host.environment,
          stdio: 'ignore',
          detached: true,
          argv0: program,
        }),
      );
      return marker;
    }

    /** Runs the step, gives the signals time to arrive, and says which of the markers were written. */
    function afterStep(
      step: 'kill' | 'uninstall',
      markers: Record<string, string>,
      parameters: ScriptParameters = parametersFor(),
    ): string[] {
      runScript(host, single(step), parameters);
      spawnSync('/bin/sleep', ['1.5']);
      return Object.keys(markers).filter(name =>
        existsSync(markers[name] ?? ''),
      );
    }

    function serverFile(): string {
      return `${dataFolder()}/cli/servers/Stable-abc123/server/node`;
    }

    /** The custom root of the connect-75 rows, as the host's install setting names it. */
    function custom(): string {
      return path.join(host.home, 'custom');
    }

    it('F-2411.BR-3: kill stops the server of the CLI path, which runs a file under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {server: started('server', serverFile())};
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), ['server']);
    });

    it("F-2411.BR-3: kill stops the server's launcher, a shell running a script under cli/servers/", () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        launcher: startedScript('launcher', 'sh', launcherScript()),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), ['launcher']);
    });

    it('F-2412 AC-27: kill leaves a sleep that only names a path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        sleeper: started('sleeper', 'sleep', ['30', serverFile()]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2412 AC-27: kill leaves an editor that only names a path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {editor: started('editor', 'vim', [serverFile()])};
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2412 AC-27: kill leaves a program that is not a shell and has a script under cli/servers/ as its first argument', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        editor: startedScript('editor', 'vim', launcherScript()),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2412 AC-27: kill leaves a shell that is not one of the four, running a script under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        fish: startedScript('fish', '/usr/bin/fish', launcherScript()),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2412 AC-27: kill leaves a program whose file only contains the path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        copy: started('copy', `/copy${serverFile()}`),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2412 AC-27: kill leaves a shell whose script only contains the path under cli/servers/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        copy: startedScript(
          'copy',
          'sh',
          path.join(dataFolder(), 'copy', launcherScript()),
        ),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2412 AC-27: kill leaves a node that runs another file', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        other: started('other', '/usr/bin/node', ['/home/user/app.js']),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    /** The install's own `node`, under bin/<commit>/, which every process of a direct install's server runs. */
    function installNode(): string {
      return `${dataFolder()}/bin/abc123/node`;
    }

    it('F-2411.BR-3: kill stops an extension host under bin/ that no pid file names', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        extensionHost: started('extensionHost', installNode(), [
          `${dataFolder()}/bin/abc123/out/bootstrap-fork`,
          '--type=extensionHost',
        ]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), ['extensionHost']);
    });

    it('F-2411.BR-3: kill stops a file watcher whose parent has gone', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        fileWatcher: started('fileWatcher', installNode(), [
          `${dataFolder()}/bin/abc123/out/bootstrap-fork`,
          '--type=fileWatcher',
        ]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), ['fileWatcher']);
    });

    it('F-2411.BR-3: kill stops a launcher shell running a script under bin/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        launcher: startedScript(
          'launcher',
          'sh',
          path.join(dataFolder(), 'bin', 'abc123', 'bin', 'code-server'),
        ),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), ['launcher']);
    });

    it('F-2412 AC-27: kill leaves a sleep that only names a path under bin/', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        sleeper: started('sleeper', 'sleep', ['30', installNode()]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2411.BR-3: kill leaves the exec-server launcher', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        launcher: started('launcher', `${dataFolder()}/code-abc123`),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it("F-2411.BR-3: kill leaves the CLI's command-shell and its supervisor", () => {
      runScript(host, single('install'), parametersFor());
      const cliFile = `${dataFolder()}/codium-cli`;
      const markers = {
        shell: started('shell', cliFile, [
          'command-shell',
          '--cli-data-dir',
          `${dataFolder()}/cli`,
        ]),
        supervisor: started('supervisor', cliFile, [
          '--cli-data-dir',
          `${dataFolder()}/cli`,
          'agent',
          'host',
        ]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('kill', markers), []);
    });

    it('F-2411.BR-4: kill keeps cli/servers/, the connection token and the agent-host token, and removes bin/', () => {
      runScript(host, single('install'), parametersFor());
      mkdirSync(path.join(dataFolder(), 'cli', 'servers', 'Stable-abc123'), {
        recursive: true,
      });
      for (const token of ['connection-token', 'agent-host-token']) {
        writeFileSync(path.join(dataFolder(), 'cli', token), 'token');
      }
      runScript(host, single('kill'), parametersFor());
      deepStrictEqual(
        [
          existsSync(
            path.join(dataFolder(), 'cli', 'servers', 'Stable-abc123'),
          ),
          existsSync(path.join(dataFolder(), 'cli', 'connection-token')),
          existsSync(path.join(dataFolder(), 'cli', 'agent-host-token')),
          existsSync(path.join(dataFolder(), 'bin')),
        ],
        [true, true, true, false],
      );
    });

    it('F-2412.BR-3: uninstall stops the server of the CLI path too', () => {
      runScript(host, single('install'), parametersFor());
      const marker = started('server', serverFile());
      spawnSync('/bin/sleep', ['0.5']);
      runScript(host, single('uninstall'), parametersFor());
      spawnSync('/bin/sleep', ['1.5']);
      deepStrictEqual(existsSync(marker), true);
    });

    /**
     * Starts a `server` at `serverPath`, waits half a second, then uninstalls with the custom root: the markers that
     * got their TERM.
     */
    function customRootUninstall(serverPath: string): string[] {
      const marker = started('server', serverPath);
      spawnSync('/bin/sleep', ['0.5']);
      return afterStep(
        'uninstall',
        {server: marker},
        {
          ...parametersFor(),
          installRoot: custom(),
        },
      );
    }

    it("F-2412.BR-3: with a custom root, uninstall stops the custom folder's server", () => {
      deepStrictEqual(
        customRootUninstall(
          path.join(
            custom(),
            '.server-data',
            'cli',
            'servers',
            'Stable-abc123',
            'server',
            'node',
          ),
        ),
        ['server'],
      );
    });

    it("F-2412.BR-3: with a custom root, uninstall stops the home folder's server too", () => {
      deepStrictEqual(customRootUninstall(serverFile()), ['server']);
    });

    it('F-2412 AC-27: uninstall stops the server and leaves the launcher, a node, a MainThread and a process that names the server folder', () => {
      runScript(host, single('install'), parametersFor());
      const markers = {
        server: started('server', serverFile()),
        launcher: started('launcher', path.join(dataFolder(), 'code-abc123')),
        node: started('node', '/usr/bin/node', ['/home/user/app.js']),
        mainThread: started('mainThread', 'MainThread'),
        naming: started('naming', 'sleep', ['30', serverFile()]),
      };
      spawnSync('/bin/sleep', ['0.5']);
      deepStrictEqual(afterStep('uninstall', markers), ['server']);
    });

    it('V1: a fact value with a line end cannot forge a result line', () => {
      const block = blockOf(host, single('probe'), parametersFor(), {
        environment: {DISPLAY: ':0\nstatus=Ok\nserver.port=1'},
      });
      deepStrictEqual(
        block === 'none' ? 'none' : block.serverFacts.port,
        undefined,
      );
    });
  });
});
