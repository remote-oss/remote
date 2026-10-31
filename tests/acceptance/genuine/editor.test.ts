import {strictEqual} from 'node:assert';
import {
  editorVersionOf,
  hostAliases,
  inWindow,
  variable,
} from '../windows/harness.ts';
import {nothingFails, rowsOf, rowsSettled} from '../windows/explorer-rows.ts';

describe('the genuine launch on the version the job names (card tooling-69)', function () {
  this.timeout(180_000);

  it('tooling-69: the editor the launch started is the version the job named', async () => {
    strictEqual(
      await editorVersionOf('local'),
      variable('HARNESS_EDITOR_VERSION'),
    );
  });

  it('F-5101 AC-4 (genuine-rows): the Remotes view shows the SSH group with the run’s ssh_config hosts, with no connect', async () => {
    await inWindow('local', 'remoteTargets.focus');
    await rowsSettled('local', rowsOf(hostAliases(), undefined));
    await nothingFails('local');
  });
});
