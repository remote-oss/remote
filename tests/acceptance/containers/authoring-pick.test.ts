import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  connectedToContainer,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  acceptQuickPick,
  allQuickPickRows,
  answerNotification,
  chooseQuickPickRow,
  clickToastLink,
  detailedQuickPickRows,
  notificationCentre,
  panelShown,
  pressQuickPickOk,
  pressQuickPickTitleButton,
  quickPickChrome,
  quickPickFacts,
  quickPickOf,
  statusItem,
  toastDetails,
  windowTitle,
} from '../windows/renderer.ts';
import {
  chooseWorkspace,
  closeScreen,
  configurationOf,
  CONFIGURATION,
  focusAfter,
  FEATURES_PLACEHOLDER,
  screenOf,
  startCommand,
  takeOptionScreen,
  withWindow,
  written,
} from '../windows/authoring-support.ts';

/** The placeholder of the template pick. */
const TEMPLATE_PLACEHOLDER =
  'Select a container configuration template or enter a custom template id';

/** The title button every option, feature and optional file pick has. */
const BACK = 'Back (Ctrl+Alt+-)';

/** The files of the run's pinned template index and of the templates it mirrors, which the rows take their expectations from. */
const INDEX_FILE = fileURLToPath(
  new URL('../fixtures/templates/devcontainer-index.json', import.meta.url),
);

/** What the pinned index says of one option of a template. */
interface IndexOption {
  type: string;
  description: string;
  default: string;
  proposals?: string[];
}

/** What the pinned index says of a template, as far as the rows read it. */
interface IndexTemplate {
  name: string;
  options: Record<string, IndexOption>;
  optionalPaths?: string[];
}

/** The template of the pinned index named `name`. */
function indexTemplate(name: string): IndexTemplate {
  const index = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as {
    collections: Array<{templates?: IndexTemplate[]}>;
  };
  const found = index.collections
    .flatMap(each => each.templates ?? [])
    .find(each => each.name === name);
  if (found === undefined) {
    throw new Error(`the pinned index has no template ${name}`);
  }
  return found;
}

/** The text of the pinned template `folder`'s file `file`, as the run unpacked it. */
function templateFile(folder: string, file: string): string {
  return readFileSync(
    path.join(
      variable('HARNESS_RUN_FOLDER'),
      'templates',
      'mirror',
      'src',
      folder,
      file,
    ),
    'utf8',
  );
}

describe('the template pick and what follows it, against the run’s pinned template index (card coverage-101)', function () {
  this.timeout(900_000);

  /** The labels of window `name`'s pick once it shows the curated list and focuses its first template. */
  async function curatedPick(
    window: string,
  ): Promise<{head: string[]; first: string | undefined; rows: string[]}> {
    await waitFor(
      'the pick to show the curated list',
      async () => {
        const rows = await detailedQuickPickRows(window);
        const labels = rows.map(each => each.label);
        return (
          labels.length > 2 &&
          labels[0] === 'Show All Templates...' &&
          labels[1] === 'Learn More' &&
          (rows.find(each => each.focused)?.label ?? '') === labels[2]
        );
      },
      30_000,
    );
    const rows = await detailedQuickPickRows(window);
    const labels = rows.map(each => each.label);
    return {
      head: [labels[0] ?? '', labels[1] ?? ''],
      first: rows.find(each => each.focused)?.label,
      rows: labels.slice(2),
    };
  }

  it('F-0403 AC-6 (reading-1808-pinned-index): a folder with a marker of no curated set shows the whole catalogue, the curated list shows Show All Templates... then Learn More at the top with their texts, its first item focused, an alphabetical base set of eight or nine items and the marker extra templates, and choosing Show All swaps in the whole catalogue with no Back button', async () => {
    const whole: string[][] = [];
    for (const [name, contents] of [
      ['c101-pick-none', {}],
      ['c101-pick-package', {'package.json': '{}'}],
      ['c101-pick-requirements', {'requirements.txt': ''}],
      ['c101-pick-composer', {'composer.json': '{}'}],
      ['c101-pick-gemfile', {Gemfile: ''}],
    ] as const) {
      await withWindow(name, contents, async window => {
        whole.push((await screenOf(window)).map(each => each.label));
        await closeScreen(window);
      });
    }
    const catalog = whole[0] ?? [];
    const base: string[] = [];
    const results: unknown[] = [];
    await withWindow('c101-pick-base', {'main.c': ''}, async window => {
      await screenOf(window);
      const seen = await curatedPick(window);
      base.push(...seen.rows);
      results.push({
        head: seen.head,
        first: seen.first === seen.rows[0],
        size: base.length >= 8 && base.length <= 9,
        ordered: seen.rows.every(
          (label, index) =>
            index === 0 || (base[index - 1] ?? '').localeCompare(label) <= 0,
        ),
      });
      await closeScreen(window);
    });
    await withWindow('c101-pick-curated', {'go.mod': ''}, async window => {
      await screenOf(window);
      const seen = await curatedPick(window);
      const learn = (await detailedQuickPickRows(window)).find(
        each => each.label === 'Learn More',
      );
      let hover = '';
      for (let step = 0; step < seen.rows.length && hover === ''; step += 1) {
        if ((await focusAfter(window, 'ArrowUp')) === 'Show All Templates...') {
          hover =
            (await detailedQuickPickRows(window)).find(
              each => each.label === 'Show All Templates...',
            )?.detail ?? '';
        }
      }
      const showAll = (await detailedQuickPickRows(window)).find(
        each => each.label === 'Show All Templates...',
      );
      await chooseQuickPickRow(window, 'Show All Templates...');
      await waitFor(
        'the whole catalogue',
        async () =>
          (await detailedQuickPickRows(window)).every(
            each => each.label !== 'Show All Templates...',
          ),
        15_000,
      );
      const swapped = (await allQuickPickRows(window)).map(each => each.label);
      const facts = await quickPickFacts(window);
      results.push({
        whole: whole.every(labels => labels.join('|') === catalog.join('|')),
        head: seen.head,
        first: seen.first === seen.rows[0],
        extras: seen.rows.length > base.length,
        ordered: seen.rows.every(
          (label, index) =>
            index === 0 ||
            (seen.rows[index - 1] ?? '').localeCompare(label) <= 0,
        ),
        baseKept: base.every(label => seen.rows.includes(label)),
        inCatalog: seen.rows.every(label => catalog.includes(label)),
        showAll: showAll?.description,
        hover,
        learn: [learn?.description, learn?.detail],
        swapped: swapped.join('|') === catalog.join('|'),
        buttons: facts?.titleButtons,
      });
      await closeScreen(window);
    });
    deepStrictEqual(results, [
      {
        head: ['Show All Templates...', 'Learn More'],
        first: true,
        size: true,
        ordered: true,
      },
      {
        whole: true,
        head: ['Show All Templates...', 'Learn More'],
        first: true,
        extras: true,
        ordered: true,
        baseKept: true,
        inCatalog: true,
        showAll: '',
        hover: 'Show all available predefined container templates.',
        learn: ['Documentation on predefined container templates', ''],
        swapped: true,
        buttons: [],
      },
    ]);
  });

  it('F-0403 AC-7 (reading-1808-pinned-index): a template with options asks one pick per list-valued option, the default focused and tagged, with Back, then one multi-select pick for its yes/no options, counted as the index defaults them', async () => {
    const seen: unknown[] = [];
    const expected: unknown[] = [];
    for (const name of ['Alpine', 'Docker in Docker']) {
      const template = indexTemplate(name);
      const options = Object.values(template.options);
      const lists = options.filter(each => each.proposals !== undefined);
      const flags = options.filter(each => each.proposals === undefined);
      await withWindow(
        `c101-options-${String(name.length)}`,
        {},
        async window => {
          await startCommand(window);
          await chooseWorkspace(window);
          await chooseQuickPickRow(window, name);
          for (const option of lists) {
            await waitFor(
              `the pick for ${option.description}`,
              async () =>
                (await quickPickOf(window))?.placeholder === option.description,
              60_000,
            );
            await new Promise(resolve => setTimeout(resolve, 500));
            const rows = await detailedQuickPickRows(window);
            seen.push([
              (await quickPickFacts(window))?.titleButtons,
              rows.map(each => [each.label, each.description, each.focused]),
            ]);
            await acceptQuickPick(window);
          }
          if (flags.length > 0) {
            const placeholder = `Select the options for the '${name}' dev container`;
            await waitFor(
              'the pick for the yes/no options',
              async () =>
                (await quickPickOf(window))?.placeholder === placeholder,
              60_000,
            );
            await new Promise(resolve => setTimeout(resolve, 500));
            seen.push([
              (await quickPickFacts(window))?.titleButtons,
              (await detailedQuickPickRows(window)).map(each => each.label),
              (await quickPickChrome(window)).counter,
            ]);
            await pressQuickPickOk(window);
          }
          await closeScreen(window);
        },
      );
      for (const option of lists) {
        expected.push([
          [BACK],
          (option.proposals ?? []).map(each => [
            each,
            each === option.default ? '(default)' : '',
            each === option.default,
          ]),
        ]);
      }
      if (flags.length > 0) {
        expected.push([
          [BACK],
          flags.map(each => each.description),
          `${String(flags.filter(each => each.default === 'true').length)} Selected`,
        ]);
      }
    }
    deepStrictEqual(seen, expected);
  });

  it('F-0403 AC-9 (reading-1808-pinned-index): Alpine’s optional files pick has its title, placeholder, count, Back and OK and the template’s optional file, and finishing with none checked writes exactly the configuration, which is the pinned template’s file with the chosen version', async () => {
    const template = indexTemplate('Alpine');
    await withWindow('c101-optional-alpine', {}, async (window, folder) => {
      await startCommand(window);
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, 'Alpine version:');
      await takeOptionScreen(window, FEATURES_PLACEHOLDER);
      await waitFor(
        'the optional files pick',
        async () =>
          (await quickPickFacts(window))?.title ===
          'Optional Files/Directories',
        60_000,
      );
      await new Promise(resolve => setTimeout(resolve, 500));
      const seen = [
        await quickPickFacts(window),
        await quickPickChrome(window),
        (await detailedQuickPickRows(window)).map(each => each.label),
      ];
      await pressQuickPickOk(window);
      await written(path.join(folder, CONFIGURATION));
      await configurationOf(folder);
      const wanted = templateFile('alpine', CONFIGURATION).replaceAll(
        '${templateOption:imageVariant}',
        template.options.imageVariant?.default ?? '',
      );
      deepStrictEqual(
        [seen, readFileSync(path.join(folder, CONFIGURATION), 'utf8')],
        [
          [
            {
              title: 'Optional Files/Directories',
              placeholder: 'Include the following optional files/directories',
              titleButtons: [BACK],
              multiSelect: true,
            },
            {counter: '0 Selected', okShown: true},
            template.optionalPaths,
          ],
          wanted,
        ],
      );
    });
  });

  it('F-0403 AC-10 (c101-connect-alpine): after the wizard the same window connects, titled with the folder and the template, its indicator going from Opening Remote... to the template, with the connecting notification and its toolbar, show log revealing the log terminal, and the notification gone with an empty centre', async () => {
    await withWindow('c101-connect-alpine', {}, async (window, folder) => {
      await startCommand(window);
      await chooseWorkspace(window);
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, 'Alpine version:');
      await takeOptionScreen(window, FEATURES_PLACEHOLDER);
      await takeOptionScreen(
        window,
        'Include the following optional files/directories',
      );
      await written(path.join(folder, CONFIGURATION));
      await waitFor(
        'the reopen notification',
        async () =>
          (await notificationCentre(window)).some(text =>
            text.startsWith(
              'Folder contains a Dev Container configuration file.',
            ),
          ),
        30_000,
      );
      const windows = await windowState(window);
      void answerNotification(
        window,
        'Folder contains a Dev Container configuration file.',
        'Reopen in Container',
      );
      let toolbar: string[] = [];
      const indicators = new Set<string>();
      await waitFor(
        'the connecting notification',
        async () => {
          const found = (await toastDetails(window).catch(() => [])).find(
            each => each.message.startsWith('Connecting to Dev Container'),
          );
          if (found === undefined) {
            return false;
          }
          toolbar = found.toolbar;
          indicators.add((await statusItem(window, 'status.host')).text);
          return true;
        },
        120_000,
      );
      await clickToastLink(
        window,
        'Connecting to Dev Container',
        'Connecting to Dev Container (show log)',
      );
      const logTerminal = await waitFor(
        'the panel with the log terminal',
        async () => panelShown(window).catch(() => false),
        30_000,
      ).then(
        () => true,
        () => false,
      );
      await connectedToContainer(window, 300_000);
      await waitFor(
        'the notification centre to be empty',
        async () => (await notificationCentre(window)).length === 0,
        60_000,
      );
      deepStrictEqual(
        [
          windows.remoteName,
          toolbar,
          indicators.has('Opening Remote...'),
          logTerminal,
          (await statusItem(window, 'status.host')).text,
          await windowTitle(window),
        ],
        [
          null,
          ['More Actions...', 'Expand Notification'],
          true,
          true,
          'Dev Container: Alpine',
          '[c101-connect-alpine [Dev Container: Alpine]]',
        ],
      );
    });
  });

  it('F-0403 AC-23 (c101-back): the where-to and template picks have no Back button, the option and Select Features picks have it, and Back returns to the previous pick, from the option pick to the template pick and from Select Features to the option pick', async () => {
    await withWindow('c101-back', {}, async window => {
      await startCommand(window);
      await waitFor(
        'the where-to pick',
        async () => (await quickPickFacts(window)) !== undefined,
        180_000,
      );
      const where = (await quickPickFacts(window))?.titleButtons;
      await chooseWorkspace(window);
      const templatePick = (await quickPickFacts(window))?.titleButtons;
      await chooseQuickPickRow(window, 'Alpine');
      await waitFor(
        'the option pick',
        async () =>
          (await quickPickOf(window))?.placeholder === 'Alpine version:',
        60_000,
      );
      const option = (await quickPickFacts(window))?.titleButtons;
      await pressQuickPickTitleButton(window, BACK);
      await waitFor(
        'the template pick again',
        async () =>
          (await quickPickOf(window))?.placeholder === TEMPLATE_PLACEHOLDER,
        60_000,
      );
      await chooseQuickPickRow(window, 'Alpine');
      await takeOptionScreen(window, 'Alpine version:');
      await waitFor(
        'Select Features',
        async () =>
          (await quickPickOf(window))?.placeholder === FEATURES_PLACEHOLDER,
        60_000,
      );
      const features = (await quickPickFacts(window))?.titleButtons;
      await pressQuickPickTitleButton(window, BACK);
      await waitFor(
        'the option pick again',
        async () =>
          (await quickPickOf(window))?.placeholder === 'Alpine version:',
        60_000,
      );
      await closeScreen(window);
      deepStrictEqual(
        [where, templatePick, option, features],
        [[], [], [BACK], [BACK, 'Finish']],
      );
    });
  });
});
