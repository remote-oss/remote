import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {type Handlers, runCommand, USAGE} from '../../src/commands.ts';

/** What a run of `words` printed on each stream, and its exit status. */
async function runOf(
  words: readonly string[],
  handlers: Handlers = {},
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
    handlers,
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
          ['service', 'install'],
          ['service', 'uninstall'],
          ['unregister'],
          ['rename', 'my-box'],
          ['--name', 'my-box'],
        ].map(words => runOf(words)),
      ),
      [
        'tunnel-agent: not built yet\n',
        'tunnel-agent login: not built yet\n',
        'tunnel-agent login --token-stdin: not built yet\n',
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

  it('hands the start, the rename and the unregister to the handlers that are built, with the name each asks for, and answers their status', async () => {
    const heard: string[] = [];
    const handlers: Handlers = {
      start: name => {
        heard.push(`start ${String(name)}`);
        return Promise.resolve(0);
      },
      rename: name => {
        heard.push(`rename ${name}`);
        return Promise.resolve(3);
      },
      unregister: () => {
        heard.push('unregister');
        return Promise.resolve(4);
      },
    };
    const statuses = [
      [],
      ['--name', 'my-box'],
      ['rename', 'new-name'],
      ['unregister'],
    ].map(async words => (await runOf(words, handlers))[2]);
    deepStrictEqual(
      [await Promise.all(statuses), heard],
      [
        [0, 0, 3, 4],
        ['start undefined', 'start my-box', 'rename new-name', 'unregister'],
      ],
    );
  });

  it('leaves a command with no handler, and a rename or a name that has none, to the answers it had', async () => {
    const handlers: Handlers = {start: () => Promise.resolve(0)};
    deepStrictEqual(
      await Promise.all(
        [['rename', 'a'], ['unregister'], ['--name', ''], ['rename', '']].map(
          words => runOf(words, handlers),
        ),
      ),
      [
        ['', 'tunnel-agent rename a: not built yet\n', 2],
        ['', 'tunnel-agent unregister: not built yet\n', 2],
        ['', `tunnel-agent: unknown command: --name \n${USAGE}\n`, 2],
        ['', `tunnel-agent: unknown command: rename \n${USAGE}\n`, 2],
      ],
    );
  });
});
