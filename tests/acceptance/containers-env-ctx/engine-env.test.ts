import {deepStrictEqual} from 'node:assert';
import {ENGINE_CONTEXT_NAME} from '../../../tools/acceptance-launches.ts';
import {
  DEAD,
  dockerWith,
  engineSettingsAre,
  showsNoEngine,
} from '../windows/engine-fixture.ts';
import {readUserSettings, restoreUserSettings} from '../windows/harness.ts';

describe('the engine of an editor that starts with a DOCKER_CONTEXT (card containers-133)', function () {
  this.timeout(300_000);

  let saved: string | undefined;

  before(async () => {
    saved = readUserSettings();
    await dockerWith(
      {},
      'context',
      'create',
      ENGINE_CONTEXT_NAME,
      '--docker',
      `host=${DEAD}`,
    );
  });

  after(async () => {
    restoreUserSettings(saved);
    await dockerWith({}, 'context', 'rm', '--force', ENGINE_CONTEXT_NAME).catch(
      () => undefined,
    );
  });

  it('F-0205 AC-14c (c133-env-context): with a DOCKER_CONTEXT of the editor that names a context nothing answers on, the view shows the welcome content of an unreachable engine, although the ambient context works', async () => {
    await engineSettingsAre(saved, {});
    deepStrictEqual(await showsNoEngine(), true);
  });
});
