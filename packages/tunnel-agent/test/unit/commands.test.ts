import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {runCommand, USAGE} from '../../src/commands.ts';

/** What a run of `words` printed on each stream, and its exit status; a login is answered with status 7. */
async function runOf(
  words: readonly string[],
  logins: boolean[] = [],
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
      login: fromStandardInput => {
        logins.push(fromStandardInput);
        return Promise.resolve(7);
      },
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
          ['service', 'install'],
          ['service', 'uninstall'],
          ['unregister'],
          ['rename', 'my-box'],
          ['--name', 'my-box'],
        ].map(words => runOf(words)),
      ),
      [
        'tunnel-agent: not built yet\n',
        'tunnel-agent service install: not built yet\n',
        'tunnel-agent service uninstall: not built yet\n',
        'tunnel-agent unregister: not built yet\n',
        'tunnel-agent rename my-box: not built yet\n',
        'tunnel-agent --name my-box: not built yet\n',
      ].map(error => ['', error, 2]),
    );
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
          ['login', 'now'],
          ['login', '--token-stdin', 'x'],
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
        'login now',
        'login --token-stdin x',
      ].map(words => [
        '',
        `tunnel-agent: unknown command: ${words}\n${USAGE}\n`,
        2,
      ]),
    );
  });

  it('hands login to its service with the device flow, and login --token-stdin with the standard input, and answers with its status', async () => {
    const logins: boolean[] = [];
    deepStrictEqual(
      [
        await runOf(['login'], logins),
        await runOf(['login', '--token-stdin'], logins),
        logins,
      ],
      [
        ['', '', 7],
        ['', '', 7],
        [false, true],
      ],
    );
  });
});
