import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {installBrowser, openedUrls} from '../windows/web-ui-support.ts';
import {
  acceptQuickPick,
  answerDialog,
  answerFolderDialog,
  chooseQuickPickRow,
  detailedQuickPickRows,
  dialogKindOf,
  moveQuickPickFocus,
  dialogOf,
  notificationCentre,
  notifications,
  primaryButtonOf,
  quickPickFacts,
  quickPickOf,
  typeInQuickPick,
  waitForDialog,
  waitForQuickPick,
} from '../windows/renderer.ts';
import {
  ALPINE_OPTION,
  chooseWorkspace,
  CONFIGURATION,
  closeScreen,
  existing,
  filesIn,
  FEATURES_PLACEHOLDER,
  focusedLabel,
  screenOf,
  screenWith,
  startCommand,
  takeFeatureScreen,
  takeOptionScreen,
  typed,
  withWindow,
  written,
} from '../windows/authoring-support.ts';

const execFileAsync = promisify(execFile);

const WRITING = 'Adding Dev Container Configuration Files...';

/** The templates of the curated list that every marker gives, in the reference's words. */
const CORE_SET = [
  'Alpine',
  'Debian',
  'Docker in Docker',
  'Docker outside of Docker',
  'Docker outside of Docker Compose',
  'Kubernetes - Local Configuration',
  'Kubernetes - Minikube-in-Docker',
  'Ubuntu',
];

/** What a `.csproj` adds. */
const CSHARP_SET = [
  'C# (.NET)',
  'C# (.NET) and MS SQL',
  'C# (.NET) and PostgreSQL',
  'F# (.NET)',
];

/** What `package.json` adds to a curating marker. */
const NODE_SET = [
  'Node.js & JavaScript',
  'Node.js & Mongo DB',
  'Node.js & PostgreSQL',
  'Node.js & TypeScript',
];

const collator = new Intl.Collator('en', {sensitivity: 'base'});

/** The labels of a curated list for the templates `names`: Show All Templates... and Learn More first, then `names` alphabetically. */
function curatedOf(names: readonly string[]): string[] {
  return [
    'Show All Templates...',
    'Learn More',
    ...[...new Set(names)].toSorted(collator.compare),
  ];
}

/** The labels of the rows of the registry's request log lines that name `needle`, counted. */
async function registryRequests(needle: string): Promise<number> {
  const runId = variable('HARNESS_RUN_ID');
  const {stdout} = await execFileAsync('docker', [
    'ps',
    '--all',
    '--format',
    '{{.ID}} {{.Image}}',
    '--filter',
    `label=remote-oss.acceptance.run=${runId}`,
  ]);
  const [registry = ''] = stdout
    .split('\n')
    .filter(line => (line.split(' ')[1] ?? '').includes('registry'))
    .map(line => line.split(' ')[0] ?? '');
  const {stdout: output, stderr} = await execFileAsync('docker', [
    'logs',
    registry,
  ]);
  return `${output}\n${stderr}`
    .split('\n')
    .filter(line => line.includes(needle)).length;
}

describe('the template screen of the wizard (card coverage-72)', function () {
  this.timeout(600_000);

  it('F-0802 AC-24, AC-34, AC-35 (c72-curated-sets): each lone marker, a lone file of no recognized type and the lone main.go and index.js give the curated list with the templates the criteria name', async () => {
    const cases: Array<
      [string, Record<string, string>, readonly string[], boolean]
    > = [
      ['c72-go-mod', {'go.mod': 'module x\n'}, [], true],
      ['c72-cargo', {'Cargo.toml': ''}, [], true],
      ['c72-pom', {'pom.xml': ''}, [], true],
      ['c72-csproj', {'app.csproj': ''}, CSHARP_SET, true],
      ['c72-xyz', {'notes.xyz': ''}, [], true],
      ['c72-foo', {'.foo': ''}, [], true],
      ['c72-dot-file', {'.devcontainer': 'a file'}, [], true],
      ['c72-sub-xyz', {'sub/notes.xyz': ''}, [], true],
      ['c72-xyz-readme', {'notes.xyz': '', 'readme.txt': ''}, [], true],
      [
        'c72-main-go',
        {'main.go': ''},
        ['Default Linux Universal', 'Go', 'Go & PostgreSQL'],
        true,
      ],
      [
        'c72-index-js',
        {'index.js': ''},
        [
          'Default Linux Universal',
          'Node.js & JavaScript',
          'Node.js & Mongo DB',
          'Node.js & PostgreSQL',
        ],
        true,
      ],
    ];
    const seen: Record<string, {missing: string[]; unexpected: string[]}> = {};
    for (const [name, contents, extra, exact] of cases) {
      await withWindow(name, contents, async window => {
        const labels = (await screenOf(window)).map(each => each.label);
        const wanted = curatedOf([...CORE_SET, ...extra]);
        const unexpected = exact
          ? labels.filter(label => !wanted.includes(label))
          : [];
        if (exact && labels.join('|') !== wanted.join('|')) {
          unexpected.push(`order: ${labels.join('|')}`);
        }
        seen[name] = {
          missing: wanted.filter(label => !labels.includes(label)),
          unexpected,
        };
        await closeScreen(window);
      });
    }
    deepStrictEqual(
      seen,
      Object.fromEntries(
        cases.map(([name]) => [name, {missing: [], unexpected: []}]),
      ),
    );
  });

  it('F-0802 AC-26 (c72-curated-package-go): package.json beside go.mod gives the core set and the Node.js templates, Node.js & TypeScript included', async () => {
    await withWindow(
      'c72-package-go',
      {'package.json': '{}', 'go.mod': ''},
      async window => {
        const labels = (await screenOf(window)).map(each => each.label);
        await closeScreen(window);
        deepStrictEqual(
          curatedOf([...CORE_SET, ...NODE_SET]).filter(
            label => !labels.includes(label),
          ),
          [],
        );
      },
    );
  });

  it('F-0802 AC-35 (c72-curated-python): a lone app.py gives the core set and the seven Python and Anaconda templates, Python 3 & PostgreSQL included', async () => {
    await withWindow('c72-app-py', {'app.py': ''}, async window => {
      const labels = (await screenOf(window)).map(each => each.label);
      await closeScreen(window);
      deepStrictEqual(
        curatedOf([...CORE_SET, 'Python 3 & PostgreSQL']).filter(
          label => !labels.includes(label),
        ),
        [],
      );
    });
  });

  it('F-0802 AC-25, AC-28, AC-30 (c72-curated-use): Show All Templates... replaces the curated list in place with the flat list, a label filter keeps Show All Templates... and Learn More, and a filter that matches no label leaves Show All Templates... focused with its hover text', async () => {
    let flat: string[] = [];
    await withWindow('c72-flat', {}, async window => {
      flat = (await screenOf(window)).map(each => each.label);
      await closeScreen(window);
    });
    await withWindow('c72-curated-go', {'go.mod': ''}, async window => {
      await screenOf(window);
      const filtered = (await typed(window, 'ubun')).map(each => each.label);
      await typed(window, 'zzzzqqqq');
      const noneLabels = (await detailedQuickPickRows(window)).map(
        each => each.label,
      );
      await moveQuickPickFocus(window, 'ArrowDown');
      await new Promise(resolve => setTimeout(resolve, 500));
      const none = await detailedQuickPickRows(window);
      const noneFocus = focusedLabel(none);
      const hover = none.find(
        each => each.label === 'Show All Templates...',
      )?.detail;
      await typed(window, '');
      await chooseQuickPickRow(window, 'Show All Templates...');
      await waitFor(
        'the flat list',
        async () =>
          (await detailedQuickPickRows(window)).every(
            each => each.label !== 'Show All Templates...',
          ),
        15_000,
      );
      const all = await detailedQuickPickRows(window);
      const allLabels = all.map(each => each.label);
      const focus = focusedLabel(all);
      await closeScreen(window);
      deepStrictEqual(
        {
          filtered,
          noneLabels,
          noneFocus,
          hover,
          sameAsFlat: allLabels.join('|') === flat.join('|'),
          focus,
        },
        {
          filtered: ['Ubuntu', 'Show All Templates...', 'Learn More'],
          noneLabels: ['Show All Templates...', 'Learn More'],
          noneFocus: 'Show All Templates...',
          hover: 'Show all available predefined container templates.',
          sameAsFlat: true,
          focus: flat[1],
        },
      );
    });
  });

  it('F-0802 AC-27 (c72-chooser-curated): the chooser’s template row opens the curated list, not the flat one, when the folder holds a curating marker beside the Dockerfile', async () => {
    let flat: string[] = [];
    await withWindow('c72-chooser-flat-base', {}, async window => {
      flat = (await screenOf(window)).map(each => each.label);
      await closeScreen(window);
    });
    const seen: unknown[] = [];
    for (const [name, contents] of [
      ['c72-chooser-go', {Dockerfile: 'FROM alpine\n', 'go.mod': ''}],
    ] as const) {
      await withWindow(name, contents, async window => {
        await startCommand(window);
        await chooseWorkspace(window);
        await chooseQuickPickRow(
          window,
          'From a predefined container configuration template...',
        );
        await waitFor(
          'the template screen',
          async () =>
            (await quickPickFacts(window))?.placeholder ===
            'Select a container configuration template or enter a custom template id',
          30_000,
        );
        const labels = (await detailedQuickPickRows(window)).map(
          each => each.label,
        );
        seen.push(labels[0], labels.join('|') === flat.join('|'));
        await closeScreen(window);
      });
    }
    deepStrictEqual(seen, ['Show All Templates...', false]);
  });

  it('F-0802 AC-18 (c72-learn-more): R-31, Learn More closes the whole wizard at once and opens our documentation, not the reference’s aka.ms page', async () => {
    installBrowser();
    await withWindow('c72-learn-more', {}, async (window, folder) => {
      await screenOf(window);
      await chooseQuickPickRow(window, 'Learn More');
      const confirmation = await waitForDialog(window, 30_000);
      await answerDialog(window, 'Open');
      await waitFor(
        'the page to be opened',
        () => openedUrls().length > 0,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      deepStrictEqual(
        {
          asked: confirmation.message.endsWith('to open the external website?'),
          pick: await quickPickOf(window),
          opened: openedUrls(),
          written: filesIn(folder),
        },
        {
          asked: true,
          pick: undefined,
          opened: [
            'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md',
          ],
          written: [],
        },
      );
    });
  });

  it('F-0802 AC-5 (c72-filter): typing a description shared by templates or words of a template’s hover text matches nothing beyond Learn More, while a label word matches its template', async () => {
    await withWindow('c72-filter', {}, async window => {
      const rows = await screenOf(window);
      const labels = rows.map(each => each.label.toLowerCase());
      const hoverWord = rows
        .flatMap(each =>
          `${each.description} ${each.detail}`.toLowerCase().split(/[^a-z]+/),
        )
        .find(
          word =>
            word.length > 6 && !labels.some(label => label.includes(word)),
        );
      const owner = (await typed(window, 'devcontainers')).map(
        each => each.label,
      );
      const hover = (await typed(window, hoverWord ?? 'no-hover-word')).map(
        each => each.label,
      );
      const byLabel = (await typed(window, 'python')).map(each => each.label);
      await closeScreen(window);
      deepStrictEqual(
        {
          haveHoverWord: hoverWord !== undefined,
          owner,
          hover,
          byLabel: byLabel.every(
            label =>
              label === 'Learn More' || label.toLowerCase().includes('python'),
          ),
          hasPython: byLabel.includes('Python 3'),
        },
        {
          haveHoverWord: true,
          owner: ['Learn More'],
          hover: ['Learn More'],
          byLabel: true,
          hasPython: true,
        },
      );
    });
  });

  it('F-0802 AC-6 (c72-options-step): a template with options gives its options pick next, and one with none (Anaconda) goes straight to Select Features', async () => {
    const seen: unknown[] = [];
    for (const [name, label, placeholder] of [
      ['c72-with-options', 'Alpine', ALPINE_OPTION],
      ['c72-no-options', 'Anaconda (Python 3)', FEATURES_PLACEHOLDER],
    ] as const) {
      await withWindow(name, {}, async window => {
        await startCommand(window);
        await chooseWorkspace(window);
        await chooseQuickPickRow(window, label);
        await screenWith(window, placeholder);
        seen.push((await quickPickFacts(window))?.placeholder);
        await closeScreen(window);
      });
    }
    deepStrictEqual(seen, [ALPINE_OPTION, FEATURES_PLACEHOLDER]);
  });

  it('F-0802 AC-11 (c72-custom-fetch): typing a custom id fetches nothing, selecting it fetches the template’s metadata and offers its options, and a fetch that fails goes on to Select Features with no error', async () => {
    const registry = variable('HARNESS_TEMPLATE_REGISTRY');
    const seen: unknown[] = [];
    await withWindow('c72-fetch-ok', {}, async window => {
      await startCommand(window);
      await chooseWorkspace(window);
      const before = await registryRequests('custom/options-lab');
      await typeInQuickPick(
        window,
        `${registry}/remote-oss-run/custom/options-lab:1`,
      );
      await new Promise(resolve => setTimeout(resolve, 3000));
      const typedOnly = await registryRequests('custom/options-lab');
      await acceptQuickPick(window);
      await screenWith(window, 'Flavour:');
      seen.push(
        typedOnly - before,
        (await registryRequests('custom/options-lab')) > typedOnly,
      );
      await closeScreen(window);
    });
    await withWindow('c72-fetch-fail', {}, async window => {
      await startCommand(window);
      await chooseWorkspace(window);
      await typeInQuickPick(
        window,
        `${registry}/remote-oss-run/custom/options-lab:9`,
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
      await acceptQuickPick(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      seen.push(await dialogOf(window));
      await closeScreen(window);
      seen.push((await notificationCentre(window)).length);
    });
    deepStrictEqual(seen, [0, true, undefined, 0]);
  });

  it('F-0802 AC-12 (c72-failure-dialog): a custom id whose apply fails shows the error modal with Cancel then Show Log (primary), with the Adding Dev Container Configuration Files toast still on screen under it until Cancel', async () => {
    await withWindow('c72-failure', {}, async (window, folder) => {
      await startCommand(window);
      await chooseWorkspace(window);
      await typeInQuickPick(
        window,
        `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/options-lab:9`,
      );
      await new Promise(resolve => setTimeout(resolve, 1500));
      await acceptQuickPick(window);
      await takeFeatureScreen(window, false);
      const dialog = await waitForDialog(window, 120_000);
      const during = {
        kind: await dialogKindOf(window),
        details: dialog.details,
        buttons: [...dialog.buttons],
        primary: await primaryButtonOf(window),
        toast: (await notifications(window)).includes(WRITING),
      };
      await answerDialog(window, 'Cancel');
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        {
          during,
          toastAfter: (await notifications(window)).includes(WRITING),
          files: existing(folder, '.devcontainer'),
        },
        {
          during: {
            kind: 'error',
            details: 'Application of the template failed.',
            buttons: ['Cancel', 'Show Log'],
            primary: 'Show Log',
            toast: true,
          },
          toastAfter: false,
          files: [],
        },
      );
    });
  });

  it('F-0802 AC-19 (c72-escape-later): Escape at Select Features or at the template’s options aborts the whole wizard, and nothing is written', async () => {
    const seen: unknown[] = [];
    for (const [name, step] of [
      ['c72-escape-features', 'features'],
      ['c72-escape-options', 'options'],
    ] as const) {
      await withWindow(name, {}, async (window, folder) => {
        await startCommand(window);
        await chooseWorkspace(window);
        await chooseQuickPickRow(window, 'Alpine');
        await screenWith(window, ALPINE_OPTION);
        if (step === 'features') {
          await takeOptionScreen(window, ALPINE_OPTION);
          await screenWith(window, FEATURES_PLACEHOLDER);
        }
        await closeScreen(window);
        await new Promise(resolve => setTimeout(resolve, 3000));
        seen.push(await quickPickOf(window), existing(folder, '.devcontainer'));
      });
    }
    deepStrictEqual(seen, [undefined, [], undefined, []]);
  });

  it('F-0802 AC-20 (c72-output): the configuration of a listed template and of custom templates, with and without options, holds none of (custom), From …, Unknown Publisher or community', async () => {
    const forbidden = [
      '(custom)',
      'From a predefined',
      "From '",
      'Unknown Publisher',
      'community',
    ];
    const found: string[] = [];
    for (const [name, pick] of [
      ['c72-out-alpine', 'listed'],
      ['c72-out-options', 'options-lab'],
      ['c72-out-bare', 'bare-lab'],
    ] as const) {
      await withWindow(name, {}, async (window, folder) => {
        await startCommand(window);
        await chooseWorkspace(window);
        if (pick === 'listed') {
          await chooseQuickPickRow(window, 'Alpine');
          await takeOptionScreen(window, ALPINE_OPTION);
        } else {
          await typeInQuickPick(
            window,
            `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/${pick}:1`,
          );
          await new Promise(resolve => setTimeout(resolve, 1500));
          await acceptQuickPick(window);
          if (pick === 'options-lab') {
            for (const placeholder of ['Flavour:', 'Channel:', 'Motto:']) {
              await takeOptionScreen(window, placeholder);
            }
            await takeOptionScreen(
              window,
              "Select the options for the 'Options Lab' dev container",
            );
          }
        }
        await takeFeatureScreen(window, pick !== 'bare-lab');
        await written(path.join(folder, CONFIGURATION));
        await new Promise(resolve => setTimeout(resolve, 2000));
        const text = readFileSync(path.join(folder, CONFIGURATION), 'utf8');
        for (const word of forbidden) {
          if (text.includes(word)) {
            found.push(`${name}: ${word}`);
          }
        }
      });
    }
    deepStrictEqual(found, []);
  });

  it('F-0802 AC-33 (c72-hand-off): Open Folder in Container on a folder with no configuration hands off to the where-to pick, and Add configuration to workspace opens the same template screen, with the same custom id threshold', async () => {
    let command: string[] = [];
    await withWindow('c72-hand-base', {}, async window => {
      command = (await screenOf(window)).map(each => each.label);
      await closeScreen(window);
    });
    await withWindow('c72-hand-start', {}, async window => {
      const target = path.join(
        variable('HARNESS_RUN_FOLDER'),
        'c72-hand-target',
      );
      await execFileAsync('mkdir', ['-p', target]);
      void inWindow(window, 'remote-containers.openFolder').catch(
        () => undefined,
      );
      await answerFolderDialog(window, target);
      await waitForQuickPick(window, 60_000);
      await chooseQuickPickRow(window, 'Add configuration to workspace');
      await waitFor(
        'the template screen',
        async () =>
          (await quickPickFacts(window))?.placeholder ===
          'Select a container configuration template or enter a custom template id',
        60_000,
      );
      const facts = await quickPickFacts(window);
      const labels = (await detailedQuickPickRows(window)).map(
        each => each.label,
      );
      const custom = (await typed(window, 'a/b/c')).map(each => each.label);
      await closeScreen(window);
      deepStrictEqual(
        {facts, same: labels.join('|') === command.join('|'), custom},
        {
          facts: {
            title: 'Add Dev Container Configuration Files',
            placeholder:
              'Select a container configuration template or enter a custom template id',
            titleButtons: [],
            multiSelect: false,
          },
          same: true,
          custom: ["Use 'a/b/c' as template...", 'Learn More'],
        },
      );
      await closeWindow('c72-hand-target').catch(() => undefined);
    });
  });

  it('F-0802 AC-29 (c72-chooser-flat): the chooser’s template row opens the flat list when the folder holds a Dockerfile and no curating marker', async () => {
    let flat: string[] = [];
    await withWindow('c72-chooser-flat-base', {}, async window => {
      flat = (await screenOf(window)).map(each => each.label);
      await closeScreen(window);
    });
    await withWindow(
      'c72-chooser-plain',
      {Dockerfile: 'FROM alpine\n'},
      async window => {
        await startCommand(window);
        await chooseWorkspace(window);
        await chooseQuickPickRow(
          window,
          'From a predefined container configuration template...',
        );
        await waitFor(
          'the template screen',
          async () =>
            (await quickPickFacts(window))?.placeholder ===
            'Select a container configuration template or enter a custom template id',
          30_000,
        );
        const labels = (await detailedQuickPickRows(window)).map(
          each => each.label,
        );
        await closeScreen(window);
        deepStrictEqual(labels.join('|'), flat.join('|'));
      },
    );
  });
});
