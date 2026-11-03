import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {CliTarget} from '../../src/cli/cli-arguments.ts';
import type {OutdatedResult} from '../../src/cli/cli-lines.ts';
import {
  versionCheckOf,
  versionLine,
} from '../../src/authoring/version-check.ts';

const FEATURE = 'ghcr.io/devcontainers/features/git:1';

/** The check over fakes: what the CLI is asked and gives, and what the scratch folder does. */
async function checked(
  answer: OutdatedResult | Error | string,
  scratchFails = false,
): Promise<{lines: string[]; targets: CliTarget[]; discarded: string[]}> {
  const sink = new MemorySink();
  const targets: CliTarget[] = [];
  const discarded: string[] = [];
  const check = versionCheckOf({
    outdated: target => {
      targets.push(target);
      return answer instanceof Error || typeof answer === 'string'
        ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the port may reject with any value
          Promise.reject(answer)
        : Promise.resolve(answer);
    },
    scratch: () =>
      scratchFails
        ? Promise.reject(new Error('no space'))
        : Promise.resolve({
            folder: '/tmp/s',
            file: '/tmp/s/.devcontainer/devcontainer.json',
          }),
    discard: folder => {
      discarded.push(folder);
      return Promise.resolve();
    },
    logger: createLogger(sink, {minimumLevel: () => 'info'}),
  });
  await check('{}', '.devcontainer/devcontainer.json');
  const lines = sink.lines.map(line => line.message);
  return {lines, targets, discarded};
}

describe('the version check after a write (card containers-150, part D)', () => {
  it('F-0807 AC-25: the CLI is asked about the copy of the written file, and the versions go to the log in one line', async () => {
    const {lines, targets, discarded} = await checked({
      kind: 'outdated',
      features: {
        [FEATURE]: {current: '1.3.2', wanted: '1.3.2', latest: '1.3.8'},
      },
    });
    deepStrictEqual(
      [
        lines,
        targets.map(each => [each.workspaceFolder, each.configFile]),
        discarded,
      ],
      [
        [
          `the version check of .devcontainer/devcontainer.json: ${FEATURE} is at 1.3.2, wanted 1.3.2, latest 1.3.8`,
        ],
        [['/tmp/s', '/tmp/s/.devcontainer/devcontainer.json']],
        ['/tmp/s'],
      ],
    );
  });

  it('F-0807 AC-25: a Feature the CLI gives no version for is told as such, and none at all is told as none', () => {
    deepStrictEqual(
      [
        versionLine('x', {
          kind: 'outdated',
          features: {
            behind: {current: undefined, wanted: undefined, latest: undefined},
          },
        }),
        versionLine('x', {kind: 'outdated', features: {}}),
      ],
      [
        'the version check of x: behind is at no version, wanted none, latest unknown',
        'the version check of x found no Feature with a version',
      ],
    );
  });

  it('F-0807 5.0 step 8: a check the CLI fails, one that throws and a scratch folder that cannot be made are each one line, and the folder is removed when it was made', async () => {
    const failed = await checked({kind: 'noResult', status: 1});
    const thrown = await checked(new Error('spawn failed'));
    const unmade = await checked({kind: 'outdated', features: {}}, true);
    const plain = await checked('refused');
    deepStrictEqual(
      [
        failed.lines.length,
        thrown.lines,
        unmade.lines,
        failed.discarded,
        unmade.discarded,
        plain.lines,
      ],
      [
        1,
        [
          'the version check of .devcontainer/devcontainer.json failed: spawn failed',
        ],
        [
          'the version check of .devcontainer/devcontainer.json failed: no space',
        ],
        ['/tmp/s'],
        [],
        [
          'the version check of .devcontainer/devcontainer.json failed: refused',
        ],
      ],
    );
  });
});
