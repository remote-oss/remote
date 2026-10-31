import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {variable, waitFor} from '../windows/harness.ts';
import {
  acceptQuickPick,
  clearQuickPickInput,
  moveQuickPickFocus,
  pressEscape,
  pressQuickPickBack,
  pressQuickPickOk,
  quickPickChecks,
  quickPickOf,
  quickPickRows,
  type QuickPickRow,
  quickPickTitle,
  toggleQuickPickRow,
  typeInQuickPick,
} from '../windows/renderer.ts';
import {
  chooseWorkspace,
  CONFIGURATION,
  startCommand,
  takeFeatureScreen,
  withWindow,
  written,
} from './authoring-support.ts';

/** The id that names one of the run's own templates in its registry, which the wizard takes as a custom id. */
function labId(name: string): string {
  return `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/custom/${name}:1`;
}

/** What a configuration the options reached holds. */
interface Written {
  name: string;
  containerEnv: Record<string, string>;
}

/** The configuration the wizard wrote into `folder`, once Select Features is taken with nothing checked and the file is there. */
async function writtenIn(window: string, folder: string): Promise<Written> {
  await takeFeatureScreen(window);
  const file = path.join(folder, CONFIGURATION);
  await written(file);
  await new Promise(resolve => setTimeout(resolve, 1000));
  return JSON.parse(readFileSync(file, 'utf8')) as Written;
}

/** Runs the wizard in `window` and takes the template `name` of the run's registry by its id; its first screen follows. */
async function startedWith(window: string, name: string): Promise<void> {
  await startCommand(window);
  await chooseWorkspace(window);
  await typeInQuickPick(window, labId(name));
  await new Promise(resolve => setTimeout(resolve, 1500));
  await acceptQuickPick(window);
}

/** Waits until the pick shows the screen whose placeholder is `placeholder`, and gives its rows. */
async function screenWith(
  window: string,
  placeholder: string,
): Promise<QuickPickRow[]> {
  await waitFor(
    `the screen ${placeholder}`,
    async () => (await quickPickOf(window))?.placeholder === placeholder,
    60_000,
  );
  await new Promise(resolve => setTimeout(resolve, 500));
  return quickPickRows(window);
}

/** Takes the focused row of each screen of `placeholders`, in turn. */
async function takenThrough(
  window: string,
  placeholders: readonly string[],
): Promise<void> {
  for (const placeholder of placeholders) {
    await screenWith(window, placeholder);
    await acceptQuickPick(window);
  }
}

const STRING_SCREENS = ['Flavour:', 'Channel:', 'Motto:'] as const;

const BOOLEAN_SCREEN = "Select the options for the 'Options Lab' dev container";

describe('the template’s options in the wizard (card containers-87)', function () {
  this.timeout(600_000);

  it('F-0803 AC-1 (size-screen): the first option screen of a template opens right after the pick, with the option’s description as its placeholder and no gate', async () => {
    await withWindow('o87-size', {}, async window => {
      await startedWith(window, 'paths-free-lab');
      const rows = await screenWith(window, 'Size:');
      deepStrictEqual(
        [rows.map(each => each.label), await quickPickTitle(window)],
        [['small', 'large'], 'Add Dev Container Configuration Files'],
      );
    });
  });

  it('F-0803 AC-2, AC-32 (default-first): the default is first, tagged and focused, and the other values keep their order', async () => {
    await withWindow('o87-default', {}, async window => {
      await startedWith(window, 'options-lab');
      const rows = await screenWith(window, 'Flavour:');
      deepStrictEqual(
        rows.map(each => [each.label, each.description, each.focused]),
        [
          ['b', '(default)', true],
          ['a', '', false],
          ['c', '', false],
        ],
      );
    });
  });

  it('F-0803 AC-4, AC-5 (booleans): the combined boolean screen follows the string screens, names the template, starts with the defaults checked and tags none', async () => {
    await withWindow('o87-booleans', {}, async window => {
      await startedWith(window, 'options-lab');
      await takenThrough(window, STRING_SCREENS);
      const rows = await screenWith(window, BOOLEAN_SCREEN);
      deepStrictEqual(
        [await quickPickChecks(window), rows.map(each => each.description)],
        [
          [
            {label: 'With docs', checked: true},
            {label: 'With tests', checked: false},
            {label: 'quiet', checked: false},
          ],
          ['', '', ''],
        ],
      );
    });
  });

  it('F-0803 AC-17, AC-23 (written-strings): the written containerEnv holds each boolean as a string whether it was checked or not, and the name uses the flavour picked', async () => {
    await withWindow('o87-written', {}, async (window, folder) => {
      await startedWith(window, 'options-lab');
      await screenWith(window, 'Flavour:');
      await moveQuickPickFocus(window, 'ArrowDown');
      await moveQuickPickFocus(window, 'ArrowDown');
      await acceptQuickPick(window);
      await takenThrough(window, ['Channel:', 'Motto:']);
      await screenWith(window, BOOLEAN_SCREEN);
      await toggleQuickPickRow(window, 'With tests');
      await toggleQuickPickRow(window, 'With docs');
      await pressQuickPickOk(window);
      const configuration = await writtenIn(window, folder);
      deepStrictEqual(
        [
          configuration.name,
          configuration.containerEnv.FLAVOUR,
          configuration.containerEnv.WITH_DOCS,
          configuration.containerEnv.WITH_TESTS,
          configuration.containerEnv.QUIET,
        ],
        ['Lab c', 'c', 'false', 'true', 'false'],
      );
    });
  });

  it('F-0803 AC-18 (typed-values): text typed on a proposals screen and on a plain-string screen is written verbatim', async () => {
    await withWindow('o87-typed', {}, async (window, folder) => {
      await startedWith(window, 'options-lab');
      await takenThrough(window, ['Flavour:']);
      await screenWith(window, 'Channel:');
      await typeInQuickPick(window, 'edge2');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await acceptQuickPick(window);
      await screenWith(window, 'Motto:');
      await typeInQuickPick(window, 'my motto');
      await new Promise(resolve => setTimeout(resolve, 1000));
      await acceptQuickPick(window);
      await screenWith(window, BOOLEAN_SCREEN);
      await pressQuickPickOk(window);
      const configuration = await writtenIn(window, folder);
      deepStrictEqual(
        [configuration.containerEnv.CHANNEL, configuration.containerEnv.MOTTO],
        ['edge2', 'my motto'],
      );
    });
  });

  it('F-0803 AC-30 (use-item): on a proposals screen the Use item comes after the matching values, is focused only when none matches, and is absent when the text is exactly a value', async () => {
    await withWindow('o87-use', {}, async window => {
      await startedWith(window, 'options-lab');
      await takenThrough(window, ['Flavour:']);
      await screenWith(window, 'Channel:');
      const shown = [];
      for (const text of ['ed', 'zz', 'edge']) {
        await typeInQuickPick(window, text);
        await new Promise(resolve => setTimeout(resolve, 1000));
        shown.push(
          (await quickPickRows(window)).map(
            each => `${each.label}|${each.description}|${String(each.focused)}`,
          ),
        );
      }
      deepStrictEqual(shown, [
        ['edge||true', 'Use: ed|(custom)|false'],
        ['Use: zz|(custom)|true'],
        ['edge||true'],
      ]);
    });
  });

  it('F-0803 AC-31 (plain-string): a plain string option’s screen lists its default alone, tagged', async () => {
    await withWindow('o87-plain', {}, async window => {
      await startedWith(window, 'options-lab');
      await takenThrough(window, ['Flavour:', 'Channel:']);
      const rows = await screenWith(window, 'Motto:');
      deepStrictEqual(
        rows.map(each => [each.label, each.description]),
        [['plain', '(default)']],
      );
    });
  });

  it('F-0803 AC-19 (escape-booleans): Escape on the boolean screen goes on with nothing checked', async () => {
    await withWindow('o87-escape-booleans', {}, async (window, folder) => {
      await startedWith(window, 'options-lab');
      await takenThrough(window, STRING_SCREENS);
      await screenWith(window, BOOLEAN_SCREEN);
      await pressEscape(window);
      const configuration = await writtenIn(window, folder);
      deepStrictEqual(
        [
          configuration.containerEnv.WITH_DOCS,
          configuration.containerEnv.WITH_TESTS,
        ],
        ['false', 'false'],
      );
    });
  });

  it('F-0803 AC-20 (escape-enum): Escape on the enum screen cancels the wizard and writes nothing', async () => {
    await withWindow('o87-escape-enum', {}, async (window, folder) => {
      await startedWith(window, 'options-lab');
      await screenWith(window, 'Flavour:');
      await pressEscape(window);
      await waitFor(
        'the wizard to end',
        async () => (await quickPickOf(window)) === undefined,
        30_000,
      );
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(existsSync(path.join(folder, '.devcontainer')), false);
    });
  });

  it('F-0803 AC-24 (back-fresh): Back from the boolean screen reopens the last string screen with its first item focused, and Back again the one before', async () => {
    await withWindow('o87-back', {}, async window => {
      await startedWith(window, 'options-lab');
      await screenWith(window, 'Flavour:');
      await moveQuickPickFocus(window, 'ArrowDown');
      await acceptQuickPick(window);
      await takenThrough(window, ['Channel:', 'Motto:']);
      await screenWith(window, BOOLEAN_SCREEN);
      await pressQuickPickBack(window);
      const motto = await screenWith(window, 'Motto:');
      await pressQuickPickBack(window);
      const channel = await screenWith(window, 'Channel:');
      deepStrictEqual(
        [
          motto.find(each => each.focused)?.label,
          channel.find(each => each.focused)?.label,
        ],
        ['plain', 'stable'],
      );
    });
  });

  it('F-0803 AC-29 (strict-enter): Enter on the enum screen with text that matches no value keeps the screen open, and the text is written nowhere', async () => {
    await withWindow('o87-strict', {}, async (window, folder) => {
      await startedWith(window, 'options-lab');
      await screenWith(window, 'Flavour:');
      await typeInQuickPick(window, 'zzz');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const rows = await quickPickRows(window);
      await acceptQuickPick(window);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const stillOpen = (await quickPickOf(window))?.placeholder;
      await clearQuickPickInput(window);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await moveQuickPickFocus(window, 'ArrowDown');
      await moveQuickPickFocus(window, 'ArrowDown');
      await acceptQuickPick(window);
      await takenThrough(window, ['Channel:', 'Motto:']);
      await screenWith(window, BOOLEAN_SCREEN);
      await pressQuickPickOk(window);
      const configuration = await writtenIn(window, folder);
      deepStrictEqual(
        [
          rows.length,
          stillOpen,
          configuration.name,
          JSON.stringify(configuration).includes('zzz'),
        ],
        [0, 'Flavour:', 'Lab c', false],
      );
    });
  });
});
