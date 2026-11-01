import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {removeContainers, setUserSetting} from '../windows/folder-windows.ts';
import {
  containersLog,
  containersLogSince,
  devContainersOf,
  reopenInContainer,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {
  acceptQuickPick,
  chooseQuickPickRow,
  clickQuickPickRow,
  clearQuickPickInput,
  detailedQuickPickRows,
  dialogOf,
  pressEscape,
  pressQuickPickOk,
  pressQuickPickTitleButton,
  quickPickChecks,
  quickPickChrome,
  quickPickFacts,
  quickPickOf,
  toggleQuickPickRow,
  typeInQuickPick,
} from '../windows/renderer.ts';
import {
  chooseWorkspace,
  configurationOf,
  CONFIGURATION,
  FEATURES_PLACEHOLDER as FEATURES,
  existing,
  startCommand,
  screenWith,
  startedWith,
  takeOptionalScreen,
  withWindow,
} from './authoring-support.ts';

const execFileAsync = promisify(execFile);

/** The labels of the Features of the run's index that its own collections publish, and the one reference Feature the rows check. */
const GIT_FEATURE = 'Git (from source)';

const LAB_OPTIONS = 'Lab Options';

const DOCKER_IN_DOCKER = 'Docker (Docker-in-Docker)';

/** What the frame of Select Features shows. */
const FEATURES_SCREEN = {
  title: 'Select Features',
  placeholder: FEATURES,
  titleButtons: ['Back (Ctrl+Alt+-)', 'Finish'],
  multiSelect: true,
};

/** The labels of the rows the Select Features screen of `window` lists now. */
async function listedLabels(window: string): Promise<string[]> {
  return (await detailedQuickPickRows(window)).map(each => each.label);
}

/** Takes the focused row of each screen the wizard shows until the screen whose placeholder is `placeholder` comes. */
async function takenUntil(window: string, placeholder: string): Promise<void> {
  for (;;) {
    await waitFor(
      'a screen of the wizard',
      async () => (await quickPickOf(window)) !== undefined,
      60_000,
    );
    await new Promise(resolve => setTimeout(resolve, 700));
    if ((await quickPickOf(window))?.placeholder === placeholder) {
      return;
    }
    await acceptQuickPick(window);
  }
}

/** The lines of the download host's request log that ask for the template and Feature index. */
function indexRequests(): number {
  const logFile = variable('HARNESS_DOWNLOADS_LOG');
  return (existsSync(logFile) ? readFileSync(logFile, 'utf8') : '')
    .split('\n')
    .filter(line => line.includes('devcontainer-index.json')).length;
}

describe('Select Features in the wizard (card containers-88)', function () {
  this.timeout(600_000);

  it('F-0802 AC-7, F-0803 AC-3, F-0804 AC-26 (features-after-options): after the last option screen comes Select Features, with Back and Finish in the title bar, a bottom OK and 0 Selected', async () => {
    await withWindow('f88-after', {}, async window => {
      await startedWith(window, 'paths-free-lab');
      await screenWith(window, 'Size:');
      const optionChrome = await quickPickChrome(window);
      await acceptQuickPick(window);
      await screenWith(window, FEATURES);
      deepStrictEqual(
        [
          optionChrome.okShown,
          await quickPickFacts(window),
          await quickPickChrome(window),
        ],
        [false, FEATURES_SCREEN, {counter: '0 Selected', okShown: true}],
      );
    });
  });

  it('F-0803 AC-3 (click-item): clicking an item of the last option screen commits it as Enter does, and Select Features follows', async () => {
    await withWindow('f88-click', {}, async window => {
      await startedWith(window, 'paths-free-lab');
      await screenWith(window, 'Size:');
      await clickQuickPickRow(window, 'small');
      await screenWith(window, FEATURES);
      deepStrictEqual(
        [await quickPickFacts(window), await quickPickChrome(window)],
        [FEATURES_SCREEN, {counter: '0 Selected', okShown: true}],
      );
    });
  });

  it('F-0802 AC-7, F-0803 AC-7 (bare-features): a template with no option goes straight from the pick to Select Features, with its title-bar buttons, its OK and 0 Selected', async () => {
    await withWindow('f88-bare', {}, async window => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      deepStrictEqual(
        [await quickPickFacts(window), await quickPickChrome(window)],
        [FEATURES_SCREEN, {counter: '0 Selected', okShown: true}],
      );
    });
  });

  it('F-0804 AC-2 (owners): a reference Feature shows devcontainers with the badge, a community Feature its owner with none, and the run’s own Feature remote-oss-run with none', async () => {
    await withWindow('f88-owners', {}, async window => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      const rows = await detailedQuickPickRows(window);
      deepStrictEqual(
        [GIT_FEATURE, 'Add Community Tool', LAB_OPTIONS].map(label =>
          rows
            .filter(each => each.label === label)
            .map(each => [
              each.description,
              each.icons.includes('codicon-verified'),
            ]),
        ),
        [
          [['devcontainers', true]],
          [['remote-oss-community', false]],
          [['remote-oss-run', false]],
        ],
      );
    });
  });

  it('F-0804 AC-3, AC-4 (filter): typing filters by label only, so an owner matches nothing, a word of a label keeps its Features, and a reference matches nothing and adds no row', async () => {
    await withWindow('f88-filter', {}, async window => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      const all = await listedLabels(window);
      const seen: string[][] = [];
      for (const typed of ['remote-oss-run', 'Lab', 'ghcr.io/x/y']) {
        await typeInQuickPick(window, typed);
        await new Promise(resolve => setTimeout(resolve, 1000));
        seen.push(await listedLabels(window));
      }
      deepStrictEqual(
        seen.map(labels => labels.toSorted()),
        [
          [],
          all.filter(label => label.toLowerCase().includes('lab')).toSorted(),
          [],
        ],
      );
    });
  });

  it('F-0804 AC-5, F-0803 AC-8 (finish): checking two Features and pressing Finish writes both with no options and shows no option screen', async () => {
    await withWindow('f88-finish', {}, async (window, folder) => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      await toggleQuickPickRow(window, LAB_OPTIONS);
      await toggleQuickPickRow(window, GIT_FEATURE);
      await pressQuickPickTitleButton(window, 'Finish');
      const configuration = await configurationOf(folder);
      deepStrictEqual(
        [
          Object.values(configuration.features ?? {}),
          Object.keys(configuration.features ?? {}).map(
            key => key.split('/').slice(-1)[0],
          ),
          await quickPickOf(window),
        ],
        [[{}, {}], ['git:1', 'lab-options:1'], undefined],
      );
    });
  });

  it('F-0804 AC-17 (defaults-unchecked): dev.containers.defaultFeatures naming a Feature pre-checks nothing', async () => {
    await setUserSetting('dev.containers.defaultFeatures', {
      'ghcr.io/devcontainers/features/git:1': {},
    });
    try {
      await withWindow('f88-defaults', {}, async window => {
        await startedWith(window, 'bare-lab');
        await screenWith(window, FEATURES);
        deepStrictEqual(
          [
            (await quickPickChecks(window)).filter(each => each.checked),
            (await quickPickChrome(window)).counter,
          ],
          [[], '0 Selected'],
        );
      });
    } finally {
      await setUserSetting('dev.containers.defaultFeatures', undefined);
    }
  });

  it('F-0804 AC-21 (no-gate): checking a community Feature and finishing shows no owner-trust dialog', async () => {
    await withWindow('f88-community', {}, async (window, folder) => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      await toggleQuickPickRow(window, 'Add Community Tool');
      await pressQuickPickOk(window);
      await configurationOf(folder);
      deepStrictEqual(await dialogOf(window), undefined);
    });
  });

  it('F-0804 AC-24 (one-fetch): a run of the wizard asks the download host for the index once', async () => {
    await withWindow('f88-fetch', {}, async window => {
      const before = indexRequests();
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      deepStrictEqual(indexRequests() - before, 1);
    });
  });

  it('F-0804 AC-25 (collation): the community Features are listed in collation order, which is not the order of their code units', async () => {
    await withWindow('f88-order', {}, async window => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      const everything = await listedLabels(window);
      const collator = new Intl.Collator('en', {sensitivity: 'base'});
      const sorted = everything.every(
        (label, index) =>
          index === 0 ||
          collator.compare(everything[index - 1] ?? '', label) <= 0,
      );
      const community = everything.filter(label =>
        ['add-community', 'Add Community Tool', 'Adobe Community Kit'].includes(
          label,
        ),
      );
      deepStrictEqual(
        [sorted, community, community.toSorted()],
        [
          true,
          ['Add Community Tool', 'add-community', 'Adobe Community Kit'],
          ['Add Community Tool', 'Adobe Community Kit', 'add-community'],
        ],
      );
    });
  });

  it('F-0804 AC-16 (escape): Escape on Select Features ends the wizard and writes nothing', async () => {
    await withWindow('f88-escape', {}, async (window, folder) => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      await clearQuickPickInput(window);
      await pressEscape(window);
      await waitFor(
        'the pick to close',
        async () => (await quickPickOf(window)) === undefined,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        [existing(folder, '.devcontainer'), await devContainersOf(folder)],
        [[], []],
      );
    });
  });

  it('F-0801 AC-40 (template-then-feature): Select Features opens with 0 Selected after the template with its defaults, and a template that carries a Feature and a picked Feature are both written, the template’s first, the picked one with no options, and no dialog shows', async () => {
    await withWindow('f88-dind', {}, async (window, folder) => {
      await startCommand(window);
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Docker in Docker');
      await takenUntil(window, FEATURES);
      const arrival = await quickPickChrome(window);
      const nothingChecked = (await quickPickChecks(window)).filter(
        each => each.checked,
      );
      await toggleQuickPickRow(window, DOCKER_IN_DOCKER);
      await pressQuickPickTitleButton(window, 'Finish');
      await takeOptionalScreen(window);
      const configuration = await configurationOf(folder);
      deepStrictEqual(
        [
          arrival.counter,
          nothingChecked,
          Object.keys(configuration.features ?? {}).map(key =>
            key.split('/').slice(-1).join(''),
          ),
          Object.values(configuration.features ?? {}),
          await dialogOf(window),
        ],
        [
          '0 Selected',
          [],
          ['docker-in-docker:2', 'docker-in-docker:4'],
          [{version: 'latest', moby: 'true'}, {}],
          undefined,
        ],
      );
    });
  });

  it('F-0804 AC-5 (built): a Feature checked in the wizard is built into the container the window reopens in', async () => {
    await withWindow('f88-built', {}, async (window, folder) => {
      await startedWith(window, 'bare-lab');
      await screenWith(window, FEATURES);
      await toggleQuickPickRow(window, LAB_OPTIONS);
      await pressQuickPickTitleButton(window, 'Finish');
      await configurationOf(folder);
      // The template's own image lacks what the run's server needs, so the written file names the run's image instead.
      const file = path.join(folder, CONFIGURATION);
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          /"image": "[^"]*"/,
          `"image": "${variable('HARNESS_DEVCONTAINER_IMAGE')}"`,
        ),
      );
      try {
        const mark = containersLog().length;
        await reopenInContainer(window).catch((caught: unknown) => {
          throw new Error(
            `${String(caught)}; the log: ${containersLogSince(mark).slice(-25).join(' | ')}`,
            {cause: caught},
          );
        });
        const [containerId = ''] = await devContainersOf(folder);
        const {stdout} = await execFileAsync('docker', [
          'exec',
          containerId,
          'cat',
          '/usr/local/share/remote-oss-run/lab-options.env',
        ]);
        deepStrictEqual(
          stdout.split('\n').some(line => line.startsWith('LEVEL=')),
          true,
        );
      } finally {
        await removeContainers(folder);
      }
    });
  });
});
