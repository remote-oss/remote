import {existsSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  inWindow,
  terminalBuffer,
  terminalFacts,
  variable,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  answerFolderDialog,
  focusTerminal,
  pressControlC,
  terminalPageFacts,
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

/** How long the window's agent has to answer for the terminals, in milliseconds. */
const AGENT_ANSWER_MILLISECONDS = 20_000;

/** What window `name`'s agent says of its terminals, or that it gave no answer in time. */
async function agentTerminalReport(name: string): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const silent = new Promise<string>(resolve => {
    timer = setTimeout(() => {
      resolve(
        `the agent gave no answer about the terminals in ${String(AGENT_ANSWER_MILLISECONDS)} ms`,
      );
    }, AGENT_ANSWER_MILLISECONDS);
  });
  const asked = terminalFacts(name).then(
    facts =>
      `the terminals are ${JSON.stringify(facts.terminals)}, the active one ${JSON.stringify(facts.active)}` +
      `${facts.stuck === undefined ? '' : `, and the step ${facts.stuck} did not finish in 10 s`}; ` +
      `the active terminal's buffer ends ${JSON.stringify((facts.text ?? '').slice(-600))}`,
    // A wait that outlives this answer ends in its own failure, which nothing reads.
    () => 'the agent failed to answer about the terminals',
  );
  try {
    return await Promise.race([asked, silent]);
  } finally {
    clearTimeout(timer);
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
    const text = await terminalText(name);
    if (text.includes(needle)) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for the terminal of ${name} to hold ${needle}; the last read was ${JSON.stringify(text)}; ` +
          `the page holds ${JSON.stringify(await terminalPageFacts(name))}; ${await agentTerminalReport(name)}`,
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
 * A `plain` run's reader is a pipe, and the terminal echoes; an `echoed` run's reader is a pty, whose echo comes back
 * through the CLI's output a little later. So the row waits, every 200 ms for up to 10 s, until the terminal holds
 * one more `Y`, then reads again 500 ms later: a second echo would show in that read, and no echo is the timeout.
 */
async function theTypedKeyStandsAlone(window: string): Promise<boolean> {
  const before = countOf(await terminalText(window), 'Y');
  await typeInTerminal(window, 'Y');
  const deadline = Date.now() + 10_000;
  let echoed = false;
  while (!echoed && Date.now() < deadline) {
    echoed = countOf(await terminalText(window), 'Y') - before >= 1;
    if (!echoed) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  await new Promise(resolve => setTimeout(resolve, 500));
  const after = countOf(await terminalText(window), 'Y');
  await typeInTerminal(window, '\n');
  return echoed && after - before === 1;
}

/** Opens the window of a dev container folder named `folderName` with `configuration`, past its folder dialog. */
async function openedWith(
  folderName: string,
  configuration: Readonly<Record<string, unknown>>,
): Promise<string> {
  const folder = devContainerFolder(folderName, configuration);
  const window = await openFolderWindow(folder);
  const opening = inWindow(window, 'remote-containers.openFolder');
  opening.catch(() => undefined);
  await answerFolderDialog(window, folder);
  return window;
}

/** The answer file `answer.txt` of folder `folderName`, as the host sees it and as the container does. */
function answerOf(folderName: string): {host: string; container: string} {
  return {
    host: path.join(variable('HARNESS_RUN_FOLDER'), folderName, 'answer.txt'),
    container: `/workspaces/${folderName}/answer.txt`,
  };
}

/** The command that reads a line with echo off after the prompt `code > `, and writes it to `answerFile`. */
function hiddenRead(answerFile: string): string {
  return `printf 'code > ' && read -r -s a && printf '\\n' && printf 'answered: %s\\n' "$a" > ${answerFile}`;
}

/** Types `SECRET7` and Enter at the `code > ` prompt; gives the answer and whether the terminal shows the text. */
async function typedHidden(
  window: string,
  answer: string,
): Promise<{answer: string; theTypedTextShows: boolean}> {
  await untilText(window, 'code > ');
  await typeInTerminal(window, 'SECRET7\n');
  await until('the command to write its answer', () => existsSync(answer));
  return {
    answer: readFileSync(answer, 'utf8'),
    theTypedTextShows: (await terminalText(window)).includes('SECRET7'),
  };
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

  it('F-0415 AC-36 (line-editing): backspace edits the line before it reaches the command (remote-oss/remote-containers#125)', async () => {
    const {window, answer} = await prompted('lineedit', 'lineedit-answer.txt');
    await typeInTerminal(window, 'ab\x7f\n');
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

  it('F-0415 AC-36 (initcmd-hidden): an initializeCommand that reads with echo off shows its prompt and not the typed text (ADR-0011)', async () => {
    const {host} = answerOf('initcmdhidden');
    const window = await openedWith('initcmdhidden', {
      initializeCommand: hiddenRead(host),
    });
    deepStrictEqual(await typedHidden(window, host), {
      answer: 'answered: SECRET7\n',
      theTypedTextShows: false,
    });
    await connectedToContainer('initcmdhidden');
    await closeWindow('initcmdhidden');
  });

  it('F-0415 AC-36 (postcreate-hidden): a postCreateCommand that reads with echo off shows its prompt and not the typed text (ADR-0011)', async () => {
    const {host, container} = answerOf('posthidden');
    const window = await openedWith('posthidden', {
      postCreateCommand: hiddenRead(container),
    });
    await untilText(window, 'code > ');
    await focusTerminal(window);
    deepStrictEqual(await typedHidden(window, host), {
      answer: 'answered: SECRET7\n',
      theTypedTextShows: false,
    });
    await connectedToContainer('posthidden');
    await closeWindow('posthidden');
  });

  it("F-0415 AC-36 (read-p-prompt): the shell's read -p shows its prompt before the answer is typed, in the container (ADR-0011)", async () => {
    const {host, container} = answerOf('readp');
    const window = await openedWith('readp', {
      postCreateCommand: `read -p "RP> " a && printf "answered: %s\\n" "$a" > ${container}`,
    });
    await untilText(window, 'RP> ');
    await focusTerminal(window);
    await typeInTerminal(window, 'Y\n');
    await until('the postCreateCommand to write its answer', () =>
      existsSync(host),
    );
    deepStrictEqual(readFileSync(host, 'utf8'), 'answered: Y\n');
    await connectedToContainer('readp');
    await closeWindow('readp');
  });

  it('ADR-0011 (pty-used): a lifecycle command runs on a terminal', async () => {
    const {host} = answerOf('ptyused');
    await openedWith('ptyused', {
      initializeCommand: `if [ -t 0 ]; then printf 'tty: yes\\n' > ${host}; else printf 'tty: no\\n' > ${host}; fi`,
    });
    await until('the initializeCommand to write its answer', () =>
      existsSync(host),
    );
    deepStrictEqual(readFileSync(host, 'utf8'), 'tty: yes\n');
    await connectedToContainer('ptyused');
    await closeWindow('ptyused');
  });

  it('F-0415 AC-36 (ctrl-c): Ctrl+C stops the running postCreateCommand, the interrupted line shows, and postStartCommand still runs (7.E6)', async () => {
    const window = await openedWith('ctrlc', {
      postCreateCommand: `sh -c 'word=CTRLC; echo "$word"-WAITING; sleep 40; echo "$word"-DONE'`,
      postStartCommand: 'echo POSTSTART-RAN',
    });
    await untilText(window, 'CTRLC-WAITING');
    await focusTerminal(window);
    await pressControlC(window);
    const interrupted = 'postCreateCommand from devcontainer.json interrupted.';
    const deadline = Date.now() + 10_000;
    let buffer = await terminalBuffer(window);
    while (
      !(buffer.includes(interrupted) && buffer.includes('POSTSTART-RAN')) &&
      Date.now() < deadline
    ) {
      await new Promise(resolve => setTimeout(resolve, 500));
      buffer = await terminalBuffer(window);
    }
    deepStrictEqual(
      {
        interruptedShows: buffer.includes(interrupted),
        postStartRan: buffer.includes('POSTSTART-RAN'),
        theCommandFinished: buffer.includes('CTRLC-DONE'),
      },
      {interruptedShows: true, postStartRan: true, theCommandFinished: false},
    );
    await connectedToContainer('ctrlc');
    await closeWindow('ctrlc');
  });
});
