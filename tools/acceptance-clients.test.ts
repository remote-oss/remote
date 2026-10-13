import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {
  callsLogOf,
  clearCalls,
  clientScript,
  clientsFolder,
  FAKE_CLIENTS,
  writeClients,
  writeTildeCopy,
} from './acceptance-clients.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('the fake ssh clients of the client search (card coverage-11)', () => {
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('clients');
    writeClients(workspace.root);
  });

  afterEach(() => {
    workspace.remove();
  });

  /** A fake client's file. */
  function fileOf(folder: string): string {
    return path.join(clientsFolder(workspace.root), folder, 'ssh');
  }

  /** Runs a fake client and gives what it printed on each stream, its status and the calls it logged. */
  function callClient(folder: string, ...clientArguments: string[]) {
    clearCalls(workspace.root);
    const result = spawnSync(fileOf(folder), clientArguments, {
      encoding: 'utf8',
    });
    return {
      output: result.stdout,
      errorOutput: result.stderr,
      status: result.status,
      calls: readFileSync(callsLogOf(workspace.root), 'utf8'),
    };
  }

  it('coverage-11: the fakes are the ten of the table, each a file named ssh in a folder of its name', () => {
    deepStrictEqual(
      FAKE_CLIENTS.map(client => client.folder),
      [
        'path',
        'configured',
        'with space',
        'fails',
        'putty',
        'lower',
        'stdout',
        'old',
        'windows',
        'notexec',
      ],
    );
  });

  it('coverage-11: every fake is mode 755 but the one that is not executable, which is 644', () => {
    deepStrictEqual(
      FAKE_CLIENTS.map(client => statSync(fileOf(client.folder)).mode & 0o777),
      FAKE_CLIENTS.map(client => (client.folder === 'notexec' ? 0o644 : 0o755)),
    );
  });

  it('coverage-11: adir is a directory', () => {
    strictEqual(
      statSync(path.join(clientsFolder(workspace.root), 'adir')).isDirectory(),
      true,
    );
  });

  it('coverage-11: the log starts empty', () => {
    strictEqual(readFileSync(callsLogOf(workspace.root), 'utf8'), '');
  });

  it('coverage-11: a check prints the banner on standard error, exits 0 and logs a check', () => {
    deepStrictEqual(callClient('path', '-V'), {
      output: '',
      errorOutput: 'OpenSSH_9.6p1, OpenSSL 3.0.13\n',
      status: 0,
      calls: 'path/ssh\tcheck\n',
    });
  });

  it('coverage-11: the check of fails exits 1 with its banner', () => {
    deepStrictEqual(
      [callClient('fails', '-V').errorOutput, callClient('fails', '-V').status],
      ['OpenSSH_9.6p1\n', 1],
    );
  });

  it('coverage-11: the check of putty prints its banner on standard output only', () => {
    const {output, errorOutput} = callClient('putty', '-V');
    deepStrictEqual([output, errorOutput], ['PuTTY Release 0.81\n', '']);
  });

  it('coverage-11: the check of stdout prints its banner on standard output only', () => {
    const {output, errorOutput} = callClient('stdout', '-V');
    deepStrictEqual(
      [output, errorOutput],
      ['OpenSSH_9.0p1, fake on stdout\n', ''],
    );
  });

  it("coverage-11: the banners of lower, old and windows are the card's", () => {
    deepStrictEqual(
      ['lower', 'old', 'windows'].map(
        folder => callClient(folder, '-V').errorOutput,
      ),
      [
        'openssh_9.0p1 lowercase fake\n',
        'OpenSSH_6.5p1, OpenSSL 1.0.1 14 Mar 2012\n',
        'OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2\n',
      ],
    );
  });

  it('coverage-11: a fake in a folder with a space logs its own name', () => {
    deepStrictEqual(
      callClient('with space', '-V').calls,
      'with space/ssh\tcheck\n',
    );
  });

  it('coverage-11: a call with -G logs options and runs the real ssh', () => {
    const {calls, status} = callClient('path', '-G', '--', 'localhost');
    deepStrictEqual([calls, status], ['path/ssh\toptions\n', 0]);
  });

  it('coverage-11: any other call logs a connect and runs the real ssh', () => {
    const {calls, status} = callClient('path', '-Q', 'cipher');
    deepStrictEqual([calls, status], ['path/ssh\tconnect\n', 0]);
  });

  it('coverage-11: -V as the first argument is a check, and -V later is not', () => {
    deepStrictEqual(
      callClient('path', '-Q', '-V').calls,
      'path/ssh\tconnect\n',
    );
  });

  it('coverage-11: -G anywhere among the arguments is a lookup', () => {
    deepStrictEqual(
      callClient('path', '-F', '/dev/null', '-G', '--', 'localhost').calls,
      'path/ssh\toptions\n',
    );
  });

  it('coverage-11: calls add lines to the log in order', () => {
    spawnSync(fileOf('path'), ['-V']);
    spawnSync(fileOf('configured'), ['-V']);
    deepStrictEqual(
      readFileSync(callsLogOf(workspace.root), 'utf8'),
      'path/ssh\tcheck\nconfigured/ssh\tcheck\n',
    );
  });

  it('coverage-11: clearing the log empties it', () => {
    spawnSync(fileOf('path'), ['-V']);
    clearCalls(workspace.root);
    strictEqual(readFileSync(callsLogOf(workspace.root), 'utf8'), '');
  });

  it('coverage-11: a name with a quote is quoted in the script', () => {
    const script = clientScript(
      {
        folder: "it's",
        banner: "a'b",
        stream: 'stderr',
        status: 0,
        mode: 0o755,
      },
      '/log',
    );
    strictEqual(script.includes("'it'\\''s/ssh'"), true);
  });

  it("coverage-11: the tilde copy is the configured client logged as tilde/ssh, mode 755, in the run's home", () => {
    writeTildeCopy(workspace.root);
    const copy = path.join(workspace.root, 'home', 'clients-copy', 'ssh');
    spawnSync(copy, ['-V']);
    deepStrictEqual(
      [
        statSync(copy).mode & 0o777,
        readFileSync(callsLogOf(workspace.root), 'utf8'),
      ],
      [0o755, 'tilde/ssh\tcheck\n'],
    );
  });
});
