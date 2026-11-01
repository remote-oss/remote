import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  editorProduct,
  onHost,
  openWindow,
  settingIn,
  waitFor,
} from '../windows/harness.ts';
import {setUserSetting} from '../windows/folder-windows.ts';

/** Waits until window `name` reads `expected` for editor.tabSize, and gives what it read last. */
async function tabSizeBecomes(
  name: string,
  expected: unknown,
): Promise<unknown> {
  let last: unknown;
  await waitFor(
    `editor.tabSize ${String(expected)} in window ${name}`,
    async () => {
      last = await settingIn(name, 'editor.tabSize');
      return last === expected;
    },
    60_000,
  );
  return last;
}

describe('settings in an SSH window (card coverage-80)', function () {
  this.timeout(300_000);

  it('F-2508 AC-10 (c80-precedence): the Remote value of a setting wins over the User one, and the Workspace value wins over both', async () => {
    const machine = `/home/harness/${editorProduct().serverDataFolderName}/data/Machine`;
    const workspace = '/home/harness/c80-precedence/.vscode';
    await setUserSetting('editor.tabSize', 3);
    await openWindow('harness', 'c80-precedence');
    try {
      const user = await tabSizeBecomes('c80-precedence', 3);
      await onHost('mkdir', '-p', machine);
      await onHost(
        'sh',
        '-c',
        `echo '{"editor.tabSize": 5}' > ${machine}/settings.json`,
      );
      const remote = await tabSizeBecomes('c80-precedence', 5);
      await onHost('mkdir', '-p', workspace);
      await onHost(
        'sh',
        '-c',
        `echo '{"editor.tabSize": 7}' > ${workspace}/settings.json`,
      );
      const folder = await tabSizeBecomes('c80-precedence', 7);
      deepStrictEqual([user, remote, folder], [3, 5, 7]);
    } finally {
      await closeWindow('c80-precedence').catch(() => undefined);
      await onHost('rm', '-f', `${machine}/settings.json`);
      await setUserSetting('editor.tabSize', undefined);
    }
  });
});
