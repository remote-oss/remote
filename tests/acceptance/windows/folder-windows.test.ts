import {deepStrictEqual} from 'node:assert';
import {type DockerRunner, removeRunContainers} from './folder-windows.ts';

/**
 * A docker that records its calls and answers `docker ps` with `listed`, one id a line, and with `registries` when the
 * registry's label is among its filters.
 */
function recording(
  listed: string,
  registries = '',
): {docker: DockerRunner; calls: string[][]} {
  const calls: string[][] = [];
  function docker(
    programArguments: readonly string[],
  ): Promise<{stdout: string}> {
    calls.push([...programArguments]);
    if (programArguments[0] !== 'ps') {
      return Promise.resolve({stdout: ''});
    }
    return Promise.resolve({
      stdout: programArguments.includes(
        'label=remote-oss.acceptance.registry=1',
      )
        ? registries
        : listed,
    });
  }
  return {docker, calls};
}

describe('the removal of the run’s containers (card tooling-74)', () => {
  it('tooling-74: lists the containers by the run’s label only and removes exactly the ones listed', async () => {
    const {docker, calls} = recording('first\nsecond\n');
    await removeRunContainers('77-2', docker);
    deepStrictEqual(calls.at(-1), ['rm', '-f', 'first', 'second']);
  });

  it('tooling-74: removes nothing when the run owns no container', async () => {
    const {docker, calls} = recording('');
    await removeRunContainers('77-2', docker);
    deepStrictEqual(
      calls.map(call => call[0]),
      ['ps', 'ps'],
    );
  });

  it('tooling-142: the run’s registry is spared: it is listed by its label and left out of the removal', async () => {
    const {docker, calls} = recording(
      'first\nregistry\nsecond\n',
      'registry\n',
    );
    await removeRunContainers('77-2', docker);
    deepStrictEqual(
      [calls.filter(call => call[0] === 'ps').length, calls.at(-1), calls[0]],
      [
        2,
        ['rm', '-f', 'first', 'second'],
        [
          'ps',
          '--all',
          '--quiet',
          '--filter',
          'label=remote-oss.acceptance.run=77-2',
          '--filter',
          'label=remote-oss.acceptance.registry=1',
        ],
      ],
    );
  });

  it('tooling-142: a run whose only container is the registry removes nothing', async () => {
    const {docker, calls} = recording('registry\n', 'registry\n');
    await removeRunContainers('77-2', docker);
    deepStrictEqual(
      calls.map(call => call[0]),
      ['ps', 'ps'],
    );
  });
});
