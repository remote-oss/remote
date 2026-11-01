import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenInContainer,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  notifications,
  pressEscape,
  quickPickFacts,
  quickPickRows,
  statusItem,
  windowTitle,
} from '../windows/renderer.ts';

/** The stage texts the connect progress may show, each once after the start title (F-0408 BR-2, F-0503 AC-2). */
const TOAST_TEXTS = [
  'Connecting to Dev Container (show log)',
  'Connecting to Dev Container (show log): Installing server',
  'Connecting to Dev Container (show log): Starting server',
];

/** One window reading: the toasts on screen, the title, and the remote indicator's text. */
interface Sample {
  texts: string[];
  title: string;
  indicator: string;
}

/** The window's current sample; a reading that fails because the window is reloading throws. */
async function sampleOf(name: string): Promise<Sample> {
  return {
    texts: await notifications(name),
    title: await windowTitle(name),
    indicator: (await statusItem(name, 'status.host')).text,
  };
}

describe('F-0401 the reopen command (card containers-40)', function () {
  this.timeout(600_000);

  it('F-0401 AC-1, AC-2 (b1): the connect shows one "Connecting to Dev Container (show log)" toast that never doubles, and the window ends titled and labelled with the container\'s name', async () => {
    const folder = devContainerFolder('c40-reopen', {name: 'Reopen One'});
    const name = await openFolderWindow(folder);
    try {
      const samples: Sample[] = [];
      const gate = {done: false};
      const sampler = (async () => {
        while (!gate.done) {
          try {
            samples.push(await sampleOf(name));
          } catch {
            // The window is reloading; skip the sample.
          }
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      })();
      await reopenInContainer(name);
      gate.done = true;
      await sampler;
      let end: Sample | undefined;
      try {
        end = await sampleOf(name);
      } catch {
        end = undefined;
      }
      if (end !== undefined) {
        samples.push(end);
      }
      const toasts = samples.flatMap(sample =>
        sample.texts.filter(text => text.startsWith('Connecting')),
      );
      console.log(
        `containers-40 b1: the distinct toast texts: ${JSON.stringify([...new Set(toasts)])}`,
      );
      const containers = await devContainersOf(folder);
      deepStrictEqual(
        {
          seen: toasts.length > 0,
          doubled: samples.some(
            sample =>
              sample.texts.filter(text =>
                text.startsWith('Connecting to Dev Container'),
              ).length > 1,
          ),
          offStage: toasts.filter(text => !TOAST_TEXTS.includes(text)),
          title: end?.title ?? '',
          indicator: end?.indicator ?? '',
          connecting:
            end?.texts.filter(text => text.startsWith('Connecting')) ?? [],
          containers: containers.length,
        },
        {
          seen: true,
          doubled: false,
          offStage: [],
          title: '[c40-reopen [Dev Container: Reopen One]]',
          indicator: 'Dev Container: Reopen One',
          connecting: [],
          containers: 1,
        },
      );
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });
  it('F-0101 AC-21 (c74-indicator-menu): the remote indicator’s pick in a dev container window has its placeholder, its first item, Rebuild Container, focused', async () => {
    const folder = devContainerFolder('c74-indicator', {name: 'Indicator'});
    const name = await openFolderWindow(folder);
    try {
      await reopenInContainer(name);
      void inWindow(name, 'workbench.action.remote.showMenu').catch(
        () => undefined,
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      const facts = await quickPickFacts(name);
      const rows = await quickPickRows(name);
      await pressEscape(name);
      await closeWindow(name);
      deepStrictEqual(
        [facts?.placeholder, rows[0]?.label, rows[0]?.focused],
        ['Select an option to open a Remote Window', 'Rebuild Container', true],
      );
    } finally {
      await removeContainers(folder);
    }
  });
});
