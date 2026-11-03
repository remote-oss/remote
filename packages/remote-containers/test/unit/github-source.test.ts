import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  githubOfferOf,
  type GithubSourcePorts,
  pickGithubRepository,
} from '../../src/volumes/github-source.ts';

/** Ports with the extensions `installed`, whose git-base picker answers `answer` and records its options. */
function portsOf(
  installed: readonly string[],
  answer?: unknown,
): {ports: GithubSourcePorts; options: unknown[]; lines: string[]} {
  const options: unknown[] = [];
  const sink = new MemorySink();
  return {
    options,
    get lines() {
      return sink.lines.map(line => line.message);
    },
    ports: {
      installed: extensionId => installed.includes(extensionId),
      activate: () =>
        Promise.resolve({
          getAPI: () => ({
            pickRemoteSource: (given: unknown) => {
              options.push(given);
              return Promise.resolve(answer);
            },
          }),
        }),
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
  };
}

const BOTH = ['vscode.git-base', 'vscode.github'];

describe('the GitHub source of the clone (card containers-151)', () => {
  it('F-0701 BR-8: offered in full from a local window and short from a remote one; not at all without either extension, said once', () => {
    const missing = portsOf(['vscode.git-base']);
    deepStrictEqual(
      [
        githubOfferOf(portsOf(BOTH).ports, false),
        githubOfferOf(portsOf(BOTH).ports, true),
        githubOfferOf(missing.ports, false),
        missing.lines,
        githubOfferOf(portsOf([]).ports, false),
      ],
      [
        'local',
        'remote',
        'none',
        ["the GitHub source isn't offered: vscode.github isn't installed"],
        'none',
      ],
    );
  });

  it('F-0701 6.3: the picker is git-base’s, with the GitHub provider, the branch step, S067 and S068', async () => {
    const seen = portsOf(BOTH, {
      url: 'https://github.com/o/r.git',
      branch: 'dev',
    });
    const picked = await pickGithubRepository(seen.ports, template => template);
    deepStrictEqual(
      [picked, seen.options],
      [
        {url: 'https://github.com/o/r.git', branch: 'dev'},
        [
          {
            providerName: 'GitHub',
            title: 'Choose a repository to clone in a Container Volume',
            placeholder: 'Choose which repository to clone',
            branch: true,
          },
        ],
      ],
    );
  });

  it('a picked address alone, an address with no branch, and a picker left give the address, the address, and nothing', async () => {
    const answers = [
      'https://github.com/o/r.git',
      {url: 'https://github.com/o/r.git'},
      undefined,
    ];
    deepStrictEqual(
      await Promise.all(
        answers.map(answer =>
          pickGithubRepository(
            portsOf(BOTH, answer).ports,
            template => template,
          ),
        ),
      ),
      [
        {url: 'https://github.com/o/r.git'},
        {url: 'https://github.com/o/r.git'},
        undefined,
      ],
    );
  });
});
