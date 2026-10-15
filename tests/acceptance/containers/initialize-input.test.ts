import {existsSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  inWindow,
  variable,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {answerFolderDialog, typeInTerminal} from '../windows/renderer.ts';

/** Resolves once `check` gives, every 500 ms, for up to `milliseconds`; a refusal at the end is thrown. */
async function until(
  description: string,
  check: () => boolean,
  milliseconds = 120_000,
): Promise<void> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    if (check()) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

describe('the input of the "Configuring..." terminal (issue #124)', function () {
  this.timeout(600_000);

  it('F-0415 AC-36 (initcmd-input): the keys typed in the terminal reach the initializeCommand, which reads its answer', async () => {
    const answerFile = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'initcmd-answer.txt',
    );
    const command = [
      `printf 'initcmd answer? '`,
      `read -r a`,
      `printf 'answered: %s\\n' "$a" > ${answerFile}`,
      `printf 'initcmd answered: %s\\n' "$a"`,
    ].join(' && ');
    const folder = devContainerFolder('initcmd', {initializeCommand: command});
    const window = await openFolderWindow(folder);
    const opening = inWindow(window, 'remote-containers.openFolder');
    opening.catch(() => undefined);
    await answerFolderDialog(window, folder);
    // The CLI runs the initializeCommand on the host before it creates the container, and it announces the run
    // with a Start line as long as the command: in the launch's small terminal the line wraps past the viewport,
    // so the row waits for the command's own process in the host's process list, which appears as the run starts.
    await until('the initializeCommand to run on the host', () =>
      spawnSync('ps', ['-eo', 'args'], {encoding: 'utf8'}).stdout.includes(
        `printf 'initcmd answer? ' && read -r a`,
      ),
    );
    await typeInTerminal(window, 'Y\n');
    await until('the initializeCommand to write its answer', () =>
      existsSync(answerFile),
    );
    deepStrictEqual(readFileSync(answerFile, 'utf8'), 'answered: Y\n');
    await connectedToContainer('initcmd');
    await closeWindow('initcmd');
  });
});
