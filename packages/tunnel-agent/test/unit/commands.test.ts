import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {runCommand, USAGE} from '../../src/commands.ts';

/** What a run of `words` printed on each stream, and its exit status. */
function runOf(words: readonly string[]): [string, string, number] {
  let printed = '';
  let complained = '';
  const status = runCommand(words, {
    stdout: text => {
      printed += text;
    },
    stderr: text => {
      complained += text;
    },
  });
  return [printed, complained, status];
}

describe("the agent's command line", () => {
  it('prints the package version for --version and nothing else, with no update check', () => {
    const {version} = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {version: string};
    deepStrictEqual(runOf(['--version']), [`${version}\n`, '', 0]);
  });

  it('prints the usage for --help', () => {
    deepStrictEqual(runOf(['--help']), [`${USAGE}\n`, '', 0]);
  });

  it('answers each command a later part builds as not built yet, with status 2', () => {
    deepStrictEqual(
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

  it('refuses an unknown command, a command with a word too many, and a rename with no name, showing the usage', () => {
    deepStrictEqual(
      [
        ['update'],
        ['--version', 'now'],
        ['service', 'restart'],
        ['rename'],
        ['rename', ''],
        ['rename', 'a', 'b'],
        ['--name'],
      ].map(words => runOf(words)),
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
