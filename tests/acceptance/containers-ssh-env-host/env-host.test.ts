/**
 * @fileoverview F-0205 AC-14 with an engine reached over SSH (card tooling-123): the editor of this launch starts with
 * the SSH Docker host's address as its `DOCKER_HOST`, and the row publishes the host there.
 */

import {deepStrictEqual} from 'node:assert';
import {SSH_ENGINE_HOST_ADDRESS} from '../../../tools/acceptance-launches.ts';
import {
  dockerWith,
  sshEngine,
  type SshEngine,
  viewLabels,
} from '../windows/engine-fixture.ts';
import {
  runLabelArguments,
  runScopedName,
  variable,
} from '../windows/harness.ts';

describe('F-0205, an engine over SSH given as the editor’s DOCKER_HOST (card tooling-123)', function () {
  this.timeout(600_000);
  let engine: SshEngine;
  const localMarker = runScopedName('c205localonly');

  before(async () => {
    engine = await sshEngine({
      hostPort: Number(new URL(SSH_ENGINE_HOST_ADDRESS).port),
    });
    const image = variable('HARNESS_DEVCONTAINER_IMAGE');
    await dockerWith(
      {},
      '--context',
      'default',
      'tag',
      image,
      `${localMarker}:only`,
    );
    await dockerWith(
      {},
      '--context',
      'default',
      'run',
      '-d',
      '--name',
      localMarker,
      ...runLabelArguments(),
      `${localMarker}:only`,
      'sleep',
      '3600',
    );
  });

  after(async () => {
    await engine.stop();
    await dockerWith({}, '--context', 'default', 'rm', '-f', localMarker).catch(
      () => undefined,
    );
    await dockerWith(
      {},
      '--context',
      'default',
      'rmi',
      `${localMarker}:only`,
    ).catch(() => undefined);
  });

  it('F-0205 AC-14 (c205-env-host): with the SSH host’s address as the editor’s DOCKER_HOST and no context switch, the view lists the container only that host holds and not the local daemon’s', async () => {
    const labels = (await viewLabels()) ?? [];
    deepStrictEqual(
      {
        remote: labels.some(each => each.startsWith(engine.marker)),
        local: labels.some(each => each.startsWith(localMarker)),
      },
      {remote: true, local: false},
    );
  });
});
