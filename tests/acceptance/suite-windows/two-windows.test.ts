import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {deepStrictEqual, strictEqual} from 'node:assert';
import * as vscode from 'vscode';
import {
  closeWindow,
  onHost,
  openWindow,
  recordLines,
  reloadWindow,
  waitUntil,
  windowEvents,
} from '../suite/harness.ts';

const execFileAsync = promisify(execFile);

/** How many connection-helper processes of this run's extensions folder run on this machine. */
async function connectionHelpers(): Promise<number> {
  try {
    const {stdout} = await execFileAsync('pgrep', [
      '-fc',
      `${process.env.HARNESS_RUN_FOLDER ?? ''}/extensions/.*connection-helper`,
    ]);
    return Number(stdout.trim());
  } catch {
    return 0;
  }
}

describe('a second window on the same host (this window is a)', () => {
  it('D-85: a second window on the same host opens and connects', async () => {
    await openWindow('harness', 'b');
    await waitUntil('the connect of window b', () =>
      recordLines('progress', 'b').some(line =>
        line.question.startsWith('Setting up SSH Host harness'),
      ),
    );
    strictEqual(windowEvents('b')[0]?.event, 'activated');
  });

  it('D-85: the two windows share one connection server', async () => {
    strictEqual(await connectionHelpers(), 1);
  });

  it('D-85: reloading the second window activates its agent again', async () => {
    await reloadWindow('b');
    deepStrictEqual(
      windowEvents('b')
        .filter(each => each.event === 'activated')
        .map(each => each.event),
      ['activated', 'activated'],
    );
  });

  it('D-85: closing the second window deactivates its agent', async () => {
    await closeWindow('b');
    strictEqual(windowEvents('b').at(-1)?.event, 'deactivated');
  });

  it('D-85: the first window is still connected after the second closed', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (folder === undefined) {
      throw new Error('the first window has no folder');
    }
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(folder, 'still-here.txt'),
      new TextEncoder().encode('a'),
    );
    strictEqual(await onHost('cat', '/home/harness/a/still-here.txt'), 'a');
  });
});
