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
import {
  answerFolderDialog,
  focusTerminal,
  terminalText,
  typeInTerminal,
} from '../windows/renderer.ts';

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

/** Resolves once window `name`'s active terminal holds `needle`, for up to `milliseconds`. */
async function untilText(
  name: string,
  needle: string,
  milliseconds = 120_000,
): Promise<void> {
  const deadline = Date.now() + milliseconds;
  for (;;) {
    if ((await terminalText(name)).includes(needle)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for the terminal of ${name} to hold ${needle}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/** How many times `needle` occurs in `text`. */
function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
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

/**
 * The echo each row asserts: the terminal, read before and after the row types a `Y`, gains exactly one `Y` from it.
 * A `plain` run's reader is a pipe that neither echoes nor edits, so the terminal is the only echo; a run whose reader
 * echoes (a TTY) must not be echoed again, or the `Y` would stand twice.
 */
async function theTypedKeyStandsAlone(window: string): Promise<boolean> {
  const before = await terminalText(window);
  await typeInTerminal(window, 'Y');
  const after = await terminalText(window);
  await typeInTerminal(window, '\n');
  return countOf(after, 'Y') - countOf(before, 'Y') === 1;
}

describe('the input of the "Configuring..." terminal', function () {
  this.timeout(600_000);

  it('F-0415 AC-36 (initcmd-input): the keys typed in the terminal reach the host-side initializeCommand, and each is echoed once (remote-oss/remote-containers#124)', async () => {
    const {window, answer} = await prompted('initcmd', 'initcmd-answer.txt');
    const echoedOnce = await theTypedKeyStandsAlone(window);
    await until('the initializeCommand to write its answer', () =>
      existsSync(answer),
    );
    deepStrictEqual(
      {
        theTypedKeyStandsAlone: echoedOnce,
        theAnswerReachedTheCommand: readFileSync(answer, 'utf8'),
      },
      {
        theTypedKeyStandsAlone: true,
        theAnswerReachedTheCommand: 'answered: Y\n',
      },
    );
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

  it('F-0415 AC-36 (prompt-shown): a prompt with no newline shows in the terminal before its answer is typed (remote-oss/remote-containers#126)', async () => {
    const answer = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'prompt-answer.txt',
    );
    const command = [
      `mark=PROMPT; mark="$mark"SHOWN`,
      `printf '%s? [Y/n] > ' "$mark"`,
      `read -r a`,
      `printf 'answered: %s\\n' "$a" > ${answer}`,
    ].join(' && ');
    const folder = devContainerFolder('promptshown', {
      initializeCommand: command,
    });
    const window = await openFolderWindow(folder);
    const opening = inWindow(window, 'remote-containers.openFolder');
    opening.catch(() => undefined);
    await answerFolderDialog(window, folder);
    await untilText(window, 'PROMPTSHOWN? [Y/n] > ', 60_000);
    await typeInTerminal(window, 'Y\n');
    await until('the initializeCommand to write its answer', () =>
      existsSync(answer),
    );
    deepStrictEqual(readFileSync(answer, 'utf8'), 'answered: Y\n');
    await connectedToContainer('promptshown');
    await closeWindow('promptshown');
  });

  it('F-0415 AC-36 (postcreate-echo): the keys typed in the terminal reach the in-container postCreateCommand, and each is echoed once (remote-oss/remote-containers#124)', async () => {
    const answer = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'postecho',
      'answer.txt',
    );
    const command = [
      `printf 'postecho answer? '`,
      `read -r a`,
      `printf 'answered: %s\\n' "$a" > /workspaces/postecho/answer.txt`,
    ].join(' && ');
    const folder = devContainerFolder('postecho', {
      postCreateCommand: command,
    });
    const window = await openFolderWindow(folder);
    const opening = inWindow(window, 'remote-containers.openFolder');
    opening.catch(() => undefined);
    await answerFolderDialog(window, folder);
    await untilText(window, 'postecho answer? ');
    await focusTerminal(window);
    const echoedOnce = await theTypedKeyStandsAlone(window);
    await until('the postCreateCommand to write its answer', () =>
      existsSync(answer),
    );
    deepStrictEqual(
      {
        theTypedKeyStandsAlone: echoedOnce,
        theAnswerReachedTheCommand: readFileSync(answer, 'utf8'),
      },
      {
        theTypedKeyStandsAlone: true,
        theAnswerReachedTheCommand: 'answered: Y\n',
      },
    );
    await connectedToContainer('postecho');
    await closeWindow('postecho');
  });
});
