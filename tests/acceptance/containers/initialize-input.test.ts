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

/**
 * The prompt the input rows type into: one line, written to `answerFile`. The CLI runs the initializeCommand on the
 * host before it creates the container, and it announces the run with a Start line as long as the command: in the
 * launch's small terminal the line wraps past the viewport, so the rows wait for the command's own process in the
 * host's process list, which appears as the run starts.
 */
async function prompted(
  folderName: string,
  answerFile: string,
): Promise<{window: string; answer: string}> {
  const answer = path.join(variable('HARNESS_RUN_FOLDER'), answerFile);
  const command = [
    `printf 'initcmd answer? '`,
    `read -r a`,
    `printf 'answered: %s\\n' "$a" > ${answer}`,
    `printf 'initcmd answered: %s\\n' "$a"`,
  ].join(' && ');
  const folder = devContainerFolder(folderName, {initializeCommand: command});
  const window = await openFolderWindow(folder);
  const opening = inWindow(window, 'remote-containers.openFolder');
  opening.catch(() => undefined);
  await answerFolderDialog(window, folder);
  await until('the initializeCommand to run on the host', () =>
    spawnSync('ps', ['-eo', 'args'], {encoding: 'utf8'}).stdout.includes(
      `printf 'initcmd answer? ' && read -r a`,
    ),
  );
  return {window, answer};
}

describe('the input of the "Configuring..." terminal', function () {
  this.timeout(600_000);

  it('F-0415 AC-36 (initcmd-input): the keys typed in the terminal reach the initializeCommand, which reads its answer (remote-oss/remote-containers#124)', async () => {
    const {window, answer} = await prompted('initcmd', 'initcmd-answer.txt');
    await typeInTerminal(window, 'Y\n');
    await until('the initializeCommand to write its answer', () =>
      existsSync(answer),
    );
    deepStrictEqual(readFileSync(answer, 'utf8'), 'answered: Y\n');
    await connectedToContainer('initcmd');
    await closeWindow('initcmd');
  });

  it('F-0415 AC-36 (line-editing): backspace and forward delete edit the line before it reaches the command (remote-oss/remote-containers#125)', async () => {
    const {window, answer} = await prompted('lineedit', 'lineedit-answer.txt');
    await typeInTerminal(window, 'ab\x7f\x1b\n');
    await until('the initializeCommand to write its answer', () =>
      existsSync(answer),
    );
    deepStrictEqual(readFileSync(answer, 'utf8'), 'answered: a\n');
    await connectedToContainer('lineedit');
    await closeWindow('lineedit');
  });
});
