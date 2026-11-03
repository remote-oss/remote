/**
 * @fileoverview Configure Container Features from the pick to the write (card containers-150, part C): which Features the
 * pick checks from the file, how Finish and OK end it, the Keep Defaults and Configure Options ways, and the edit the
 * write makes to the text of the file.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  acceptQuickPick,
  clearQuickPickInput,
  detailedQuickPickRows,
  dialogOf,
  editorTabs,
  pressEscape,
  pressQuickPickTitleButton,
  quickPickChecks,
  quickPickChrome,
  quickPickFacts,
  quickPickRows,
  statusItem,
  toggleQuickPickRow,
  typeInQuickPick,
} from '../windows/renderer.ts';
import {
  FEATURES_PLACEHOLDER,
  screenWith,
} from '../windows/authoring-support.ts';

const COMMAND = 'remote-containers.configureContainerFeatures';
const GATE = 'Keep Feature defaults or configure options?';
const GIT_LABEL = 'Git (from source)';
const COMMON = 'Common Utilities';
const LAB_LABEL = 'Lab Options';
const LAB_PLAIN = 'Lab Plain';

/** A folder of the run named `label` whose configuration is `text`. */
function folderWith(label: string, text: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
  writeFileSync(path.join(folder, '.devcontainer', 'devcontainer.json'), text);
  return folder;
}

/** The text of the configuration of `folder`. */
function configurationText(folder: string): string {
  return readFileSync(
    path.join(folder, '.devcontainer', 'devcontainer.json'),
    'utf8',
  );
}

/** Opens a window on a folder with the configuration `text`, runs the command, and gives the window once Select Features shows. */
async function opened(
  label: string,
  text: string,
): Promise<{window: string; folder: string}> {
  const folder = folderWith(label, text);
  const window = await openFolderWindow(folder);
  inWindow(window, COMMAND).catch(() => undefined);
  await screenWith(window, FEATURES_PLACEHOLDER);
  return {window, folder};
}

/** Runs `body` over a window opened by `opened`, and closes the window after. */
async function withPick(
  label: string,
  text: string,
  body: (window: string, folder: string) => Promise<void>,
): Promise<void> {
  const {window, folder} = await opened(label, text);
  try {
    await body(window, folder);
  } finally {
    await closeWindow(window).catch(() => undefined);
  }
}

/** The name of a row from its accessible label, which also holds the owner. */
function labelOf(label: string): string {
  return label.split(', ')[0] ?? label;
}

/** The keys of "features" in `text`. */
function keysOf(text: string): string[] {
  const parsed = JSON.parse(text) as {features?: Record<string, unknown>};
  return Object.keys(parsed.features ?? {});
}

/** The keys the run's catalogue gives its Features, by the last segment of the key without the version. */
const KEYS: Record<string, string> = {};

/** The key of the Feature `name` as the catalogue writes it. */
function keyOf(name: string): string {
  const found = KEYS[name];
  if (found === undefined) {
    throw new Error(`no key for ${name}`);
  }
  return found;
}

/** The JSON text of the entry of the Feature `name` in the configuration of `folder`. */
function featureValue(folder: string, name: string): string {
  const parsed = JSON.parse(configurationText(folder)) as {
    features?: Record<string, unknown>;
  };
  return JSON.stringify(parsed.features?.[keyOf(name)]);
}

/** The id of the Feature `name` without its version. */
function idOf(name: string): string {
  return keyOf(name).split(':').slice(0, -1).join(':');
}

/** Waits until the configuration of `folder` holds `text`. */
async function containing(folder: string, text: string): Promise<void> {
  await waitFor(
    `${text} in the configuration`,
    () => configurationText(folder).includes(text),
    60_000,
  );
}

/** Waits until the file of `folder` has `count` Features. */
async function featuresWritten(folder: string, count: number): Promise<void> {
  await waitFor(
    `${String(count)} Features in the configuration`,
    () => keysOf(configurationText(folder)).length === count,
    60_000,
  );
}

describe('Configure Container Features: the pick and the write (card containers-150, part C)', function () {
  this.timeout(600_000);

  before(async () => {
    await withPick('c150-keys', '{"image": "x"}\n', async (window, folder) => {
      for (const label of [GIT_LABEL, COMMON, LAB_LABEL]) {
        await toggleQuickPickRow(window, label);
      }
      await pressQuickPickTitleButton(window, 'Finish');
      await featuresWritten(folder, 3);
      const keys = keysOf(configurationText(folder));
      for (const [name, tail] of [
        [GIT_LABEL, '/git:'],
        [COMMON, '/common-utils:'],
        [LAB_LABEL, '/lab-options:'],
      ] as const) {
        const key = keys.find(each => each.includes(tail));
        if (key !== undefined) {
          KEYS[name] = key;
        }
      }
    });
  });

  it('F-0807 AC-9, AC-10, AC-11, F-0804 AC-1, AC-14 (c150-checked, reading-1971-picker-is-f0804s): the pick has a checkbox for every item, Finish and OK and no Back, checks the Features the file lists under any version form, counts them, and checks none for another registry, a bare id or a digest-pinned reference', async () => {
    const gitId = idOf(GIT_LABEL);
    const commonId = idOf(COMMON);
    const listed = JSON.stringify({
      features: {[`${gitId}:1.2`]: {}, [`${commonId}:latest`]: {x: 1}},
    });
    const other = JSON.stringify({
      features: {
        'ghcr.io/other/features/git:1': {},
        'common-utils': {},
        [`${idOf(LAB_LABEL)}@sha256:${'a'.repeat(64)}`]: {},
      },
    });
    let first: unknown;
    let boxesOfFirst = 0;
    await withPick('c150-checked-a', listed, async window => {
      const checks = await quickPickChecks(window);
      boxesOfFirst = checks.length;
      first = {
        facts: await quickPickFacts(window),
        chrome: await quickPickChrome(window),
        rows: (await quickPickRows(window)).length,
        boxes: checks.length,
        checked: checks
          .filter(each => each.checked)
          .map(each => labelOf(each.label)),
      };
      await pressEscape(window);
    });
    let second: unknown;
    await withPick('c150-checked-b', other, async window => {
      const checks = await quickPickChecks(window);
      second = {
        checked: checks.filter(each => each.checked).map(each => each.label),
        chrome: await quickPickChrome(window),
      };
      await pressEscape(window);
    });
    deepStrictEqual(
      [first, second],
      [
        {
          facts: {
            title: 'Select Features',
            placeholder: FEATURES_PLACEHOLDER,
            titleButtons: ['Finish'],
            multiSelect: true,
          },
          chrome: {counter: '2 Selected', okShown: true},
          rows: boxesOfFirst,
          boxes: boxesOfFirst,
          checked: [COMMON, GIT_LABEL],
        },
        {checked: [], chrome: {counter: '0 Selected', okShown: true}},
      ],
    );
  });

  it('F-0807 AC-12 (reading-1971-picker-is-f0804s): typing narrows the list to the items whose label matches, and a text that only the raw reference holds matches no item', async () => {
    await withPick('c150-filter', '{}', async window => {
      await typeInQuickPick(window, 'common');
      await new Promise(resolve => setTimeout(resolve, 700));
      const narrowed = (await quickPickRows(window)).map(each => each.label);
      await clearQuickPickInput(window);
      await typeInQuickPick(window, 'ghcr.io/devcontainers');
      await new Promise(resolve => setTimeout(resolve, 700));
      const byReference = (await quickPickRows(window)).map(each => each.label);
      await pressEscape(window);
      deepStrictEqual([narrowed, byReference], [[COMMON], []]);
    });
  });

  it('F-0807 AC-30 (c150-escape): Escape with items toggled closes the pick and leaves the file byte for byte and no editor open', async () => {
    const text = '{\n    "image": "x"\n}\n';
    await withPick('c150-escape', text, async (window, folder) => {
      const tabsBefore = (await editorTabs(window)).length;
      await toggleQuickPickRow(window, GIT_LABEL);
      await pressEscape(window);
      await new Promise(resolve => setTimeout(resolve, 1500));
      deepStrictEqual(
        [
          configurationText(folder),
          await quickPickFacts(window),
          (await editorTabs(window)).length,
        ],
        [text, undefined, tabsBefore],
      );
    });
  });

  it('F-0807 AC-13, AC-14, AC-17, AC-18, AC-31, AC-44, AC-45, AC-63, F-0804 AC-21 (c150-add): Finish adds the new keys in catalogue order after the existing entries, keeps comments, indentation and the other keys, and leaves a local, an unindexed, a bare, a digest-pinned and an other-version entry as they were', async () => {
    const pinned = `${idOf(LAB_LABEL)}@sha256:${'b'.repeat(64)}`;
    const otherVersion = `${idOf(COMMON)}:9`;
    const text = [
      '{',
      '    // the image',
      '    "image": "x", /* inline */',
      '    "features": {',
      '        "./local": {},',
      '        "ghcr.io/other/ns/thing:1": {"y": 2},',
      '        "bare": "lts",',
      `        "${pinned}": {},`,
      `        "${otherVersion}": {"extra": 3} // note`,
      '    },',
      '    "name": "n" // tail',
      '}',
      '',
    ].join('\n');
    await withPick('c150-add', text, async (window, folder) => {
      await toggleQuickPickRow(window, LAB_LABEL);
      await toggleQuickPickRow(window, GIT_LABEL);
      await pressQuickPickTitleButton(window, 'Finish');
      await containing(folder, keyOf(LAB_LABEL));
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(
        [
          configurationText(folder),
          (await statusItem(window, 'status.editor.selection')).text,
          await dialogOf(window),
        ],
        [
          [
            '{',
            '    // the image',
            '    "image": "x", /* inline */',
            '    "features": {',
            '        "./local": {},',
            '        "ghcr.io/other/ns/thing:1": {"y": 2},',
            '        "bare": "lts",',
            `        "${pinned}": {},`,
            `        "${otherVersion}": {"extra": 3},`,
            `        "${keyOf(COMMON)}": {},`,
            `        "${keyOf(GIT_LABEL)}": {},`,
            `        "${keyOf(LAB_LABEL)}": {} // note`,
            '    },',
            '    "name": "n" // tail',
            '}',
            '',
          ].join('\n'),
          'Ln 1, Col 1',
          undefined,
        ],
      );
    });
  });

  it('F-0807 AC-15, AC-16, AC-46, F-0804 AC-15 (c150-change): Finish gives a key that is there {}, removes an unchecked one and leaves "features": {} when it was the only one, and an other-version key stays when the preselected item is unchecked', async () => {
    const withValues = JSON.stringify(
      {features: {[keyOf(GIT_LABEL)]: {version: 'x'}}},
      null,
      4,
    );
    let overwritten: unknown;
    await withPick('c150-overwrite', withValues, async (window, folder) => {
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the value to become {}',
        () => featureValue(folder, GIT_LABEL) === '{}',
        60_000,
      );
      overwritten = featureValue(folder, GIT_LABEL);
    });
    const only = JSON.stringify({features: {[keyOf(GIT_LABEL)]: {}}}, null, 4);
    let removed: unknown;
    await withPick('c150-remove', only, async (window, folder) => {
      await toggleQuickPickRow(window, GIT_LABEL);
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the key to go',
        () => keysOf(configurationText(folder)).length === 0,
        60_000,
      );
      removed = JSON.parse(configurationText(folder));
    });
    const otherVersion = `${idOf(COMMON)}:9`;
    const kept = JSON.stringify(
      {features: {[otherVersion]: {extra: 3}}},
      null,
      4,
    );
    let left: unknown;
    await withPick('c150-other-version', kept, async (window, folder) => {
      await toggleQuickPickRow(window, COMMON);
      await pressQuickPickTitleButton(window, 'Finish');
      await new Promise(resolve => setTimeout(resolve, 2000));
      left = configurationText(folder);
    });
    deepStrictEqual([overwritten, removed, left], ['{}', {features: {}}, kept]);
  });

  it('F-0807 AC-27 (c150-zero): Finish with nothing checked and no "features" leaves the file byte for byte', async () => {
    const text = '{\n    "image": "x"\n}\n';
    await withPick('c150-zero', text, async (window, folder) => {
      await pressQuickPickTitleButton(window, 'Finish');
      await new Promise(resolve => setTimeout(resolve, 2000));
      deepStrictEqual(configurationText(folder), text);
    });
  });

  it('F-0807 AC-54 (c150-comma): a file with a missing comma gets the entry and keeps the error', async () => {
    const text = '{\n    "image": "x"\n    "name": "n"\n}\n';
    await withPick('c150-comma', text, async (window, folder) => {
      await toggleQuickPickRow(window, GIT_LABEL);
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the entry to be written',
        () => configurationText(folder).includes('features'),
        60_000,
      );
      deepStrictEqual(
        configurationText(folder),
        `{\n    "image": "x"\n    "name": "n",\n    "features": {\n        "${keyOf(GIT_LABEL)}": {}\n    }\n}\n`,
      );
    });
  });

  it('F-0807 AC-55 (c150-array): a "features" that is an array is left as it is and no editor opens', async () => {
    const text = '{\n    "features": []\n}\n';
    await withPick('c150-array', text, async (window, folder) => {
      const tabsBefore = (await editorTabs(window)).length;
      await toggleQuickPickRow(window, GIT_LABEL);
      await pressQuickPickTitleButton(window, 'Finish');
      await new Promise(resolve => setTimeout(resolve, 2500));
      deepStrictEqual(
        [configurationText(folder), (await editorTabs(window)).length],
        [text, tabsBefore],
      );
    });
  });

  it('F-0807 AC-32, AC-33, AC-35 (c150-ok): OK with a Feature checked asks to keep the defaults or configure, with Keep Defaults focused and no title button, and Keep Defaults writes what Finish writes; OK with nothing checked asks nothing', async () => {
    const text = '{\n    "image": "x"\n}\n';
    let gate: unknown;
    let kept = '';
    await withPick('c150-ok-keep', text, async (window, folder) => {
      await toggleQuickPickRow(window, GIT_LABEL);
      await acceptQuickPick(window);
      await waitFor(
        'the question',
        async () => (await quickPickFacts(window))?.title === GATE,
        60_000,
      );
      gate = {
        facts: await quickPickFacts(window),
        rows: (await detailedQuickPickRows(window)).map(each => [
          each.label,
          each.focused,
        ]),
      };
      await acceptQuickPick(window);
      await featuresWritten(folder, 1);
      kept = configurationText(folder);
    });
    let finished = '';
    await withPick('c150-ok-finish', text, async (window, folder) => {
      await toggleQuickPickRow(window, GIT_LABEL);
      await pressQuickPickTitleButton(window, 'Finish');
      await featuresWritten(folder, 1);
      finished = configurationText(folder);
    });
    let asked: unknown;
    await withPick('c150-ok-zero', text, async (window, folder) => {
      await acceptQuickPick(window);
      await new Promise(resolve => setTimeout(resolve, 2500));
      asked = [await quickPickFacts(window), configurationText(folder)];
    });
    deepStrictEqual(
      [gate, kept === finished, asked],
      [
        {
          facts: {
            title: GATE,
            placeholder: '',
            titleButtons: [],
            multiSelect: false,
          },
          rows: [
            ['Keep Defaults', true],
            ['Configure Options', false],
          ],
        },
        true,
        [undefined, text],
      ],
    );
  });

  it('F-0807 AC-34, AC-36, AC-48, AC-49, F-0803 AC-22 (c150-configure): Configure Options walks the Feature with Back and Finish, from the schema’s defaults and not the file’s values, and writes an object; Escape on the question goes into the walk and a second Escape writes nothing; Back on the first step writes nothing; the next run checks the Feature', async () => {
    const text = JSON.stringify(
      {features: {[keyOf(LAB_LABEL)]: {level: 'high'}}},
      null,
      4,
    );
    const walkTitle = `Select boolean options for '${LAB_LABEL}'`;
    /** Presses OK with the Feature checked, waits for the question, and Escape into the walk. */
    async function intoWalk(window: string): Promise<void> {
      await acceptQuickPick(window);
      await waitFor(
        'the question',
        async () => (await quickPickFacts(window))?.title === GATE,
        60_000,
      );
      await pressEscape(window);
      await waitFor(
        'the first screen of the walk',
        async () => (await quickPickFacts(window))?.title === walkTitle,
        60_000,
      );
    }
    let escaped: unknown;
    await withPick('c150-configure-escape', text, async (window, folder) => {
      await intoWalk(window);
      await pressEscape(window);
      await new Promise(resolve => setTimeout(resolve, 1500));
      escaped = configurationText(folder);
    });
    let back: unknown;
    await withPick('c150-configure-back', text, async (window, folder) => {
      await intoWalk(window);
      await pressQuickPickTitleButton(window, 'Back (Ctrl+Alt+-)');
      await new Promise(resolve => setTimeout(resolve, 1500));
      back = [configurationText(folder), await quickPickFacts(window)];
    });
    let walked: unknown;
    await withPick('c150-configure', text, async (window, folder) => {
      await intoWalk(window);
      const buttons = (await quickPickFacts(window))?.titleButtons;
      await acceptQuickPick(window);
      await waitFor(
        'the level screen',
        async () =>
          (await quickPickFacts(window))?.title ===
          `Select options for '${LAB_LABEL}'`,
        60_000,
      );
      const focused = (await detailedQuickPickRows(window)).find(
        each => each.focused,
      );
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the object',
        () => featureValue(folder, LAB_LABEL) !== '{"level":"high"}',
        60_000,
      );
      walked = [buttons, focused?.label, featureValue(folder, LAB_LABEL)];
    });
    let checkedAgain: unknown;
    await withPick(
      'c150-configure-again',
      JSON.stringify(
        {features: {[keyOf(LAB_LABEL)]: {enabled: true, level: 'low'}}},
        null,
        4,
      ),
      async window => {
        const checks = await quickPickChecks(window);
        await pressEscape(window);
        checkedAgain = checks
          .filter(each => each.checked)
          .map(each => labelOf(each.label));
      },
    );
    deepStrictEqual(
      [escaped, back, walked, checkedAgain],
      [
        text,
        [text, undefined],
        [
          ['Back (Ctrl+Alt+-)', 'Finish'],
          'low',
          '{"enabled":true,"level":"low"}',
        ],
        [LAB_LABEL],
      ],
    );
  });

  it('F-0807 AC-34 (c150-plain): a Feature with no option checked with OK and Configure Options gets {}', async () => {
    await withPick('c150-plain', '{}', async (window, folder) => {
      await toggleQuickPickRow(window, LAB_PLAIN);
      await acceptQuickPick(window);
      await waitFor(
        'the question',
        async () => (await quickPickFacts(window))?.title === GATE,
        60_000,
      );
      await pressEscape(window);
      await featuresWritten(folder, 1);
      deepStrictEqual(
        Object.values(
          (
            JSON.parse(configurationText(folder)) as {
              features: Record<string, unknown>;
            }
          ).features,
        ),
        [{}],
      );
    });
  });
});
