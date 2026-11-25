/**
 * @fileoverview The connection's notification over the editor's command-line program on a host that lacks the editor's
 * server (F-2103 AC-22): the program fetches the server inside its own wait and tells the window nothing of it, so the
 * window shows the download from the missing folder, and the install and the tunnel while they last, all before it
 * resolves.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  onHostAs,
  openWindow,
  recordLines,
} from '../windows/harness.ts';
import {
  DATA_FOLDER,
  freshHost,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';

/** The stages of the server's setup, in the order the notification must show the ones that occur. */
const STAGES = [
  'Initializing VS Code Server',
  'Downloading VS Code Server',
  'Installing VS Code Server',
  'Setting up SSH tunnel',
];

/** The setup stages window `name` showed before its notification ended at the resolve, in order, each once. */
function stagesBeforeResolve(name: string): string[] {
  const lines = recordLines(undefined, name);
  const ended = lines.find(line => line.surface === 'progressEnd')?.time;
  const shown = lines
    .filter(
      line =>
        line.surface === 'progress' &&
        STAGES.includes(line.question) &&
        (ended === undefined || line.time <= ended),
    )
    .map(line => line.question);
  return shown.filter((stage, index) => shown.indexOf(stage) === index);
}

/** Whether `stages` keep the order of `STAGES`. */
function inOrder(stages: readonly string[]): boolean {
  return stages.every(
    (stage, index) =>
      index === 0 ||
      STAGES.indexOf(stages[index - 1] ?? '') < STAGES.indexOf(stage),
  );
}

/** Ends the program and its servers on the host and removes its folder, so the next connect fetches the server. */
async function noServerOnHost(): Promise<void> {
  await freshHost();
  // The bracket keeps pkill's pattern from matching this shell's own command line.
  await onHostAs(
    'harness',
    'sh',
    '-c',
    `pkill -f '${DATA_FOLDER.replace('/.', '/[.]')}/' || true; rm -rf '${DATA_FOLDER}'`,
  );
}

describe("the connection's notification over the CLI on a host without the server (card #3175)", function () {
  this.timeout(600_000);

  it('F-2103 AC-22 (c3028-exec-download): a first connect to a host without the server shows Initializing, then Downloading, then each later stage that occurs, in order, before the window resolves; a second connect starts at Initializing and shows no Downloading', async () => {
    await noServerOnHost();
    const first = 'c3028-exec-download';
    await openWindow('harness', first);
    let firstStages: string[];
    try {
      await connectedWithin(first, INSTALL_MILLISECONDS);
      firstStages = stagesBeforeResolve(first);
    } finally {
      await closeWindow(first).catch(() => undefined);
    }
    const second = 'c3028-exec-present';
    await openWindow('harness', second);
    let secondStages: string[];
    try {
      await connectedWithin(second, INSTALL_MILLISECONDS);
      secondStages = stagesBeforeResolve(second);
    } finally {
      await closeWindow(second).catch(() => undefined);
    }
    deepStrictEqual(
      {
        first: firstStages.slice(0, 2),
        firstInOrder: inOrder(firstStages),
        secondFirst: secondStages[0],
        secondDownloads: secondStages.includes('Downloading VS Code Server'),
      },
      {
        first: ['Initializing VS Code Server', 'Downloading VS Code Server'],
        firstInOrder: true,
        secondFirst: 'Initializing VS Code Server',
        secondDownloads: false,
      },
      JSON.stringify({firstStages, secondStages}),
    );
  });
});
