import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  docker,
  listingOnly,
  pickedContainer,
  removeGroup,
  started,
} from '../windows/attach-support.ts';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  closeWindow,
  variable,
  waitFor,
  windowNames,
  windowState,
} from '../windows/harness.ts';
import {pressEscape, rememberPage} from '../windows/renderer.ts';

const NAME = 'c163-connect';
const MARKS = '/tmp/c163-marks';

/** The attach file of the container `NAME`, in the extension's global storage. */
function attachFile(): string {
  return path.join(
    variable('HARNESS_USER_DATA'),
    'User',
    'globalStorage',
    'remote-oss.remote-containers',
    'nameConfigs',
    `${NAME}.json`,
  );
}

describe('Attached connect (card containers-163, #2030)', function () {
  this.timeout(600_000);

  before(() => rememberPage('local'));

  afterEach(async () => {
    await pressEscape('local').catch(() => undefined);
    await setUserSetting('dev.containers.dockerPath', undefined);
  });

  it('F-0601 AC-1, AC-12, F-0602 AC-11, F-0417 AC-14 (c163-connect): a picked container opens a window that connects as an attached container, its attach file’s blocking and background commands run in it, and closing the window leaves the container running', async () => {
    await started(NAME, 'connect');
    mkdirSync(path.dirname(attachFile()), {recursive: true});
    writeFileSync(
      attachFile(),
      JSON.stringify({
        waitFor: 'postAttachCommand',
        postAttachCommand: `echo run >> ${MARKS}`,
      }),
    );
    await setUserSetting(
      'dev.containers.dockerPath',
      listingOnly(NAME, 'connect'),
    );
    const before = windowNames();
    let added: string[] = [];
    try {
      await pickedContainer(`/${NAME}`);
      await waitFor(
        'a new window',
        () => Promise.resolve(windowNames().length > before.length),
        120_000,
      );
      added = windowNames().filter(name => !before.includes(name));
      const [attached = ''] = added;
      await waitFor(
        'the new window to connect as an attached container',
        async () =>
          (await windowState(attached)).remoteName === 'attached-container',
        240_000,
      );
      await waitFor(
        'the commands to have run twice',
        async () =>
          Number(
            await docker('exec', NAME, 'sh', '-c', `wc -l < ${MARKS}`).catch(
              () => '0',
            ),
          ) >= 2,
        120_000,
      );
      await closeWindow(attached);
      added = [];
      await new Promise(resolve => setTimeout(resolve, 30_000));
      deepStrictEqual(
        await docker('inspect', '--format', '{{.State.Running}}', NAME),
        'true',
      );
    } finally {
      for (const name of added) {
        await closeWindow(name).catch(() => undefined);
      }
      rmSync(attachFile(), {force: true});
      await removeGroup('connect');
    }
  });
});
