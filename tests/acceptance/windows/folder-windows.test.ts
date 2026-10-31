import {deepStrictEqual} from 'node:assert';
import {type DockerRunner, removeRunContainers} from './folder-windows.ts';

/** A docker that records its calls and answers `docker ps` with `listed`, one id a line. */
function recording(listed: string): {docker: DockerRunner; calls: string[][]} {
  const calls: string[][] = [];
  function docker(
    programArguments: readonly string[],
  ): Promise<{stdout: string}> {
    calls.push([...programArguments]);
    return Promise.resolve({
      stdout: programArguments[0] === 'ps' ? listed : '',
    });
  }
  return {docker, calls};
}

describe('the removal of the run’s containers (card tooling-74)', () => {
  it('tooling-74: lists the containers by the run’s label only and removes exactly the ones listed', async () => {
    const {docker, calls} = recording('first\nsecond\n');
    await removeRunContainers('77-2', docker);
    deepStrictEqual(calls, [
      [
        'ps',
        '--all',
        '--quiet',
        '--filter',
        'label=remote-oss.acceptance.run=77-2',
      ],
      ['rm', '-f', 'first', 'second'],
    ]);
  });

  it('tooling-74: removes nothing when the run owns no container', async () => {
    const {docker, calls} = recording('');
    await removeRunContainers('77-2', docker);
    deepStrictEqual(
      calls.map(call => call[0]),
      ['ps'],
    );
  });
});
