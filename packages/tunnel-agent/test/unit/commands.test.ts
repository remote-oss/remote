import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runCommand, USAGE} from '../../src/commands.ts';

/** What a run of `words` printed on each stream, and its exit status. */
async function runOf(
  words: readonly string[],
): Promise<[string, string, number]> {
  let printed = '';
  let complained = '';
  const status = await runCommand(
    words,
    {
      stdout: text => {
        printed += text;
      },
      stderr: text => {
        complained += text;
      },
    },
    {
      runner: () => Promise.resolve({kind: 'failedToStart', message: 'unused'}),
      home: '/nowhere',
      user: 'nobody',
      launcher: '/nowhere/tunnel-agent',
    },
  );
  return [printed, complained, status];
}

describe("the agent's command line", () => {
  it('prints the package version for --version and nothing else, with no update check', async () => {
    const {version} = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {version: string};
    deepStrictEqual(await runOf(['--version']), [`${version}\n`, '', 0]);
  });

  it('prints the usage for --help', async () => {
    deepStrictEqual(await runOf(['--help']), [`${USAGE}\n`, '', 0]);
  });

  it('answers each command a later part builds as not built yet, with status 2', async () => {
    deepStrictEqual(
      await Promise.all(
        [
          [],
          ['login'],
          ['login', '--token-stdin'],
          ['unregister'],
          ['rename', 'my-box'],
          ['--name', 'my-box'],
        ].map(words => runOf(words)),
      ),
      [
        'tunnel-agent: not built yet\n',
        'tunnel-agent login: not built yet\n',
        'tunnel-agent login --token-stdin: not built yet\n',
        'tunnel-agent unregister: not built yet\n',
        'tunnel-agent rename my-box: not built yet\n',
        'tunnel-agent --name my-box: not built yet\n',
      ].map(error => ['', error, 2]),
    );
  });

  it('runs service install and service uninstall over the runner it is given, and prints what they print', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tunnel-agent-commands-'));
    try {
      const calls: string[] = [];
      let printed = '';
      const ports = {
        runner: (program: string, programArguments: readonly string[]) => {
          calls.push([program, ...programArguments].join(' '));
          return Promise.resolve({
            kind: 'exited' as const,
            status: 0,
            stdout: '',
            stderr: '',
          });
        },
        home,
        user: 'alice',
        launcher: '/opt/agent/bin/tunnel-agent',
      };
      const output = {
        stdout: (text: string) => {
          printed += text;
        },
        stderr: () => undefined,
      };
      const statuses = [
        await runCommand(['service', 'install'], output, ports),
        await runCommand(['service', 'uninstall'], output, ports),
      ];
      deepStrictEqual(
        [
          statuses,
          calls.map(call => call.split(' ').slice(0, 4).join(' ')),
          printed,
        ],
        [
          [0, 0],
          [
            'systemctl --user daemon-reload',
            'systemctl --user enable --now',
            'loginctl show-user alice -p',
            'systemctl --user disable --now',
            'systemctl --user daemon-reload',
          ],
          'Installed and started remote-oss-tunnel-agent.service.\nStopped and removed remote-oss-tunnel-agent.service.\n',
        ],
      );
    } finally {
      rmSync(home, {recursive: true, force: true});
    }
  });

  it('refuses an unknown command, a command with a word too many, and a rename with no name, showing the usage', async () => {
    deepStrictEqual(
      await Promise.all(
        [
          ['update'],
          ['--version', 'now'],
          ['service', 'restart'],
          ['rename'],
          ['rename', ''],
          ['rename', 'a', 'b'],
          ['--name'],
        ].map(words => runOf(words)),
      ),
      [
        'update',
        '--version now',
        'service restart',
        'rename',
        'rename ',
        'rename a b',
        '--name',
      ].map(words => [
        '',
        `tunnel-agent: unknown command: ${words}\n${USAGE}\n`,
        2,
      ]),
    );
  });
});
