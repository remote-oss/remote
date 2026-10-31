import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {devContainersOf, waitFor} from '../windows/harness.ts';
import {
  acceptQuickPick,
  chooseQuickPickRow,
  clearQuickPickInput,
  pressEscape,
  pressQuickPickBack,
  pressQuickPickOk,
  pressQuickPickTitleButton,
  quickPickChecks,
  quickPickChrome,
  quickPickFacts,
  quickPickOf,
  quickPickRows,
  quickPickTitle,
  toggleQuickPickRow,
  typeInQuickPick,
} from '../windows/renderer.ts';
import {
  ALPINE_OPTION,
  chooseWorkspace,
  CONFIGURATION,
  configurationOf,
  existing,
  FEATURES_PLACEHOLDER,
  screenWith,
  startCommand,
  startedWith,
  takeOptionScreen,
  withWindow,
} from './authoring-support.ts';

const GATE_TITLE = 'Keep Feature defaults or configure options?';

const LAB_OPTIONS = 'Lab Options';

const LAB_PLAIN = 'Lab Plain';

const GIT_FEATURE = 'Git (from source)';

const COMMON_UTILITIES = 'Common Utilities';

/** The title and the placeholder of the boolean screen of a Feature named `name`. */
function booleanScreen(name: string): {title: string; placeholder: string} {
  return {
    title: `Select boolean options for '${name}'`,
    placeholder: `Select boolean options for ${name}`,
  };
}

const LAB_BOOLEANS = booleanScreen(LAB_OPTIONS);

/** The title of a value screen of a Feature named `name`. */
function valueTitle(name: string): string {
  return `Select options for '${name}'`;
}

/** Waits for the screen whose title is `title` and lets it settle. */
async function titled(window: string, title: string): Promise<void> {
  await waitFor(
    `the title ${title}`,
    async () => (await quickPickTitle(window)) === title,
    60_000,
  );
  await new Promise(resolve => setTimeout(resolve, 500));
}

/** Runs the wizard on the bare template and presses OK on Select Features with the Features `labels` checked. */
async function confirmed(
  window: string,
  labels: readonly string[],
): Promise<void> {
  await startedWith(window, 'bare-lab');
  await screenWith(window, FEATURES_PLACEHOLDER);
  for (const label of labels) {
    await toggleQuickPickRow(window, label);
  }
  await pressQuickPickOk(window);
}

/** As `confirmed`, then waits for the gate. */
async function atGate(
  window: string,
  labels: readonly string[],
): Promise<void> {
  await confirmed(window, labels);
  await titled(window, GATE_TITLE);
}

/** As `atGate`, then chooses Configure Options and waits for the screen titled `title`. */
async function walkingTo(
  window: string,
  labels: readonly string[],
  title: string,
): Promise<void> {
  await atGate(window, labels);
  await chooseQuickPickRow(window, 'Configure Options');
  await titled(window, title);
}

/** Presses OK on the boolean screen of Lab Options as it stands, then waits for `Level:`. */
async function pastBooleans(window: string): Promise<void> {
  await pressQuickPickOk(window);
  await screenWith(window, 'Level:');
}

/** The entries of the Features the configuration holds, by the last part of each key. */
async function entriesIn(folder: string): Promise<Record<string, unknown>> {
  const features = (await configurationOf(folder)).features ?? {};
  return Object.fromEntries(
    Object.entries(features).map(([key, value]) => [
      key.split('/').slice(-1).join(''),
      value,
    ]),
  );
}

/** Waits until the wizard has ended with nothing written. */
async function endedWithNothing(
  window: string,
  folder: string,
): Promise<unknown[]> {
  await waitFor(
    'the pick to close',
    async () => (await quickPickOf(window)) === undefined,
    30_000,
  );
  await new Promise(resolve => setTimeout(resolve, 3000));
  return [existing(folder, '.devcontainer'), await devContainersOf(folder)];
}

describe('the Features’ options in the wizard (card containers-89)', function () {
  this.timeout(600_000);

  it('F-0803 AC-9 (no-options): OK with only a Feature that declares no option writes its entry as {} and shows no gate', async () => {
    await withWindow('o89-plain', {}, async (window, folder) => {
      await confirmed(window, [LAB_PLAIN]);
      deepStrictEqual(
        [await entriesIn(folder), await quickPickOf(window)],
        [{'lab-plain:1': {}}, undefined],
      );
    });
  });

  it('F-0803 AC-10, AC-11 (gate): OK with a Feature that declares options gives the gate, a single-select with Keep Defaults first and focused and Configure Options second, and no placeholder or title button; Keep Defaults writes {}', async () => {
    await withWindow('o89-gate', {}, async (window, folder) => {
      await atGate(window, [LAB_OPTIONS]);
      const facts = await quickPickFacts(window);
      const rows = (await quickPickRows(window)).map(each => [
        each.label,
        each.focused,
      ]);
      await acceptQuickPick(window);
      deepStrictEqual(
        [facts, rows, await entriesIn(folder)],
        [
          {
            title: GATE_TITLE,
            placeholder: '',
            titleButtons: [],
            multiSelect: false,
          },
          [
            ['Keep Defaults', true],
            ['Configure Options', false],
          ],
          {'lab-options:1': {}},
        ],
      );
    });
  });

  it('F-0803 AC-12, AC-16, AC-28, F-0804 AC-6 (walk-defaults): Configure Options with Lab Options and Lab Plain walks only Lab Options, and takes its defaults as {enabled: true, level, tone} with no verbose and no installPath, Lab Plain as {}', async () => {
    await withWindow('o89-walk', {}, async (window, folder) => {
      await walkingTo(window, [LAB_OPTIONS, LAB_PLAIN], LAB_BOOLEANS.title);
      await pastBooleans(window);
      await acceptQuickPick(window);
      await screenWith(window, 'Tone:');
      await acceptQuickPick(window);
      deepStrictEqual(await entriesIn(folder), {
        'lab-options:1': {enabled: true, level: 'low', tone: 'calm'},
        'lab-plain:1': {},
      });
    });
  });

  it('F-0803 AC-13, AC-14, F-0804 AC-23 (boolean-screen): the boolean screen of a Feature comes first, titled and placed for the Feature, with each key as its label, enabled checked and described, verbose unchecked and described by nothing', async () => {
    await withWindow('o89-booleans', {}, async window => {
      await walkingTo(window, [LAB_OPTIONS], LAB_BOOLEANS.title);
      const facts = await quickPickFacts(window);
      const rows = (await quickPickRows(window)).map(each => [
        each.label,
        each.description,
      ]);
      deepStrictEqual(
        [facts?.placeholder, rows, await quickPickChecks(window)],
        [
          LAB_BOOLEANS.placeholder,
          [
            ['enabled', 'Enabled'],
            ['verbose', ''],
          ],
          [
            {label: 'enabled, Enabled', checked: true},
            {label: 'verbose', checked: false},
          ],
        ],
      );
    });
  });

  it('F-0803 AC-15, AC-32 (value-screens): after the booleans each string option that offers values gets a screen, Level: with low (default) and high in the schema order, then Tone: with calm (default) and loud, and the plain string gets none', async () => {
    await withWindow('o89-values', {}, async window => {
      await walkingTo(window, [LAB_OPTIONS], LAB_BOOLEANS.title);
      await pastBooleans(window);
      const level = await quickPickRows(window);
      const levelTitle = await quickPickTitle(window);
      await acceptQuickPick(window);
      const tone = await screenWith(window, 'Tone:');
      deepStrictEqual(
        [
          levelTitle,
          level.map(each => [each.label, each.description, each.focused]),
          tone.map(each => [each.label, each.description]),
        ],
        [
          valueTitle(LAB_OPTIONS),
          [
            ['low', '(default)', true],
            ['high', '', false],
          ],
          [
            ['calm', '(default)'],
            ['loud', ''],
          ],
        ],
      );
    });
  });

  it('F-0803 AC-16, AC-18 (typed-tone): a value typed on the proposals screen is written verbatim, and an unchecked boolean is left out', async () => {
    await withWindow('o89-typed', {}, async (window, folder) => {
      await walkingTo(window, [LAB_OPTIONS], LAB_BOOLEANS.title);
      await toggleQuickPickRow(window, 'enabled');
      await pastBooleans(window);
      await chooseQuickPickRow(window, 'high');
      await screenWith(window, 'Tone:');
      await typeInQuickPick(window, 'breezy');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await acceptQuickPick(window);
      deepStrictEqual(await entriesIn(folder), {
        'lab-options:1': {level: 'high', tone: 'breezy'},
      });
    });
  });

  it('F-0803 AC-19 (escape-gate): Escape on the gate goes on to configure the options', async () => {
    await withWindow('o89-escape-gate', {}, async window => {
      await atGate(window, [LAB_OPTIONS]);
      await clearQuickPickInput(window);
      await pressEscape(window);
      await titled(window, LAB_BOOLEANS.title);
      deepStrictEqual(await quickPickTitle(window), LAB_BOOLEANS.title);
    });
  });

  it('F-0803 AC-21 (escape-value): Escape on a value screen ends the wizard and writes nothing', async () => {
    await withWindow('o89-escape-value', {}, async (window, folder) => {
      await walkingTo(window, [LAB_OPTIONS], LAB_BOOLEANS.title);
      await pastBooleans(window);
      await clearQuickPickInput(window);
      await pressEscape(window);
      deepStrictEqual(await endedWithNothing(window, folder), [[], []]);
    });
  });

  it('F-0803 AC-25 (back-value): Back on a value screen opens Select Features again with 0 Selected', async () => {
    await withWindow('o89-back', {}, async window => {
      await walkingTo(window, [LAB_OPTIONS], LAB_BOOLEANS.title);
      await pastBooleans(window);
      await pressQuickPickBack(window);
      await screenWith(window, FEATURES_PLACEHOLDER);
      deepStrictEqual(
        [
          (await quickPickChrome(window)).counter,
          (await quickPickChecks(window)).filter(each => each.checked),
        ],
        ['0 Selected', []],
      );
    });
  });

  it('F-0803 AC-26, AC-27 (finish-mid-walk): Finish on the first value screen of Git counts that value, leaves Git’s later options out and goes on to Lab Options', async () => {
    await withWindow('o89-finish', {}, async (window, folder) => {
      await walkingTo(
        window,
        [GIT_FEATURE, LAB_OPTIONS],
        booleanScreen(GIT_FEATURE).title,
      );
      await pressQuickPickOk(window);
      await titled(window, valueTitle(GIT_FEATURE));
      const version = (await quickPickRows(window)).find(
        each => each.focused,
      )?.label;
      await pressQuickPickTitleButton(window, 'Finish');
      await titled(window, LAB_BOOLEANS.title);
      await pastBooleans(window);
      await acceptQuickPick(window);
      await screenWith(window, 'Tone:');
      await acceptQuickPick(window);
      deepStrictEqual(await entriesIn(folder), {
        'git:1': {['ppa']: true, version},
        'lab-options:1': {enabled: true, level: 'low', tone: 'calm'},
      });
    });
  });

  it('F-0803 AC-29 (strict-enter): Enter on Level: with text that matches no value keeps the screen open', async () => {
    await withWindow('o89-strict', {}, async window => {
      await walkingTo(window, [LAB_OPTIONS], LAB_BOOLEANS.title);
      await pastBooleans(window);
      await typeInQuickPick(window, 'zzz');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const rows = await quickPickRows(window);
      await acceptQuickPick(window);
      await new Promise(resolve => setTimeout(resolve, 1500));
      deepStrictEqual(
        [rows.length, (await quickPickOf(window))?.placeholder],
        [0, 'Level:'],
      );
    });
  });

  it('F-0803 AC-30 (use-item): on Tone: the Use item follows the matching values, is focused only when none matches, and is absent when the text is exactly a value', async () => {
    await withWindow('o89-use', {}, async window => {
      await walkingTo(window, [LAB_OPTIONS], LAB_BOOLEANS.title);
      await pastBooleans(window);
      await acceptQuickPick(window);
      await screenWith(window, 'Tone:');
      const shown = [];
      for (const text of ['lo', 'zz', 'loud']) {
        await typeInQuickPick(window, text);
        await new Promise(resolve => setTimeout(resolve, 1000));
        shown.push(
          (await quickPickRows(window)).map(
            each => `${each.label}|${each.description}|${String(each.focused)}`,
          ),
        );
      }
      deepStrictEqual(shown, [
        ['loud||true', 'Use: lo|(custom)|false'],
        ['Use: zz|(custom)|true'],
        ['loud||true'],
      ]);
    });
  });

  it('F-0804 AC-19 (label-order): a Feature checked after another is still walked in the order of the list, Git before Lab Options', async () => {
    await withWindow('o89-order', {}, async window => {
      await atGate(window, [LAB_OPTIONS, GIT_FEATURE]);
      await chooseQuickPickRow(window, 'Configure Options');
      await titled(window, booleanScreen(GIT_FEATURE).title);
      deepStrictEqual(
        await quickPickTitle(window),
        booleanScreen(GIT_FEATURE).title,
      );
    });
  });

  it('F-0801 AC-41 (alpine-features): Alpine with Common Utilities and Keep Defaults writes a features object directly after image with that one key and {}, and the template’s commented lines are as without it', async () => {
    const written: Array<{
      lines: string[];
      keys: string[];
      features: unknown;
    }> = [];
    for (const [name, labels] of [
      ['o89-alpine-bare', []],
      ['o89-alpine-utils', [COMMON_UTILITIES]],
    ] as const) {
      await withWindow(name, {}, async (window, folder) => {
        await startCommand(window);
        await chooseWorkspace(window);
        await chooseQuickPickRow(window, 'Alpine');
        await takeOptionScreen(window, ALPINE_OPTION);
        await screenWith(window, FEATURES_PLACEHOLDER);
        for (const label of labels) {
          await toggleQuickPickRow(window, label);
        }
        await pressQuickPickOk(window);
        if (labels.length > 0) {
          await titled(window, GATE_TITLE);
          await acceptQuickPick(window);
        }
        const configuration = await configurationOf(folder);
        written.push({
          lines: readFileSync(path.join(folder, CONFIGURATION), 'utf8')
            .split('\n')
            .filter(line => line.trim().startsWith('//')),
          keys: Object.keys(configuration),
          features: Object.values(configuration.features ?? {}),
        });
      });
    }
    deepStrictEqual(
      [
        written[1]?.lines,
        written[1]?.keys.slice(0, 3),
        written[1]?.features,
        written[0]?.keys.includes('features'),
      ],
      [written[0]?.lines, ['name', 'image', 'features'], [{}], false],
    );
  });
});
