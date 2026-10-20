import {deepStrictEqual} from 'node:assert';
import {
  type BooleanScreen,
  pickBooleans,
  pickValue,
  type QuickInputPorts,
  type ValueScreen,
} from '../../src/authoring/option-screens.ts';
import {BACK_BUTTON, scriptedInput} from './option-picker.fixture.ts';

const NEVER = new AbortController().signal;

/** A value screen with the fields a row does not care about at their usual values. */
function screenOf(overrides: Partial<ValueScreen> = {}): ValueScreen {
  return {
    title: 'Add Dev Container Configuration Files',
    placeholder: 'Flavour:',
    values: ['a', 'b', 'c'],
    defaultValue: 'b',
    strict: true,
    defaultFirst: true,
    finishButton: false,
    ...overrides,
  };
}

/** The screens over a quick input that plays nobody; the first screen the code makes is `picker`. */
function sceneOf(): {
  quick: QuickInputPorts;
  picker: () => ReturnType<typeof scriptedInput>['pickers'][number];
} {
  const input = scriptedInput([]);
  return {
    quick: {...input.ports, translate: template => template},
    picker: () => {
      const [first] = input.pickers;
      if (first === undefined) {
        throw new Error('no screen was made');
      }
      return first;
    },
  };
}

describe('the value screen of an option (card containers-87)', () => {
  it('F-0803 5.0 step 1: the screen has the wizard’s title, the option’s description as its placeholder, a Back button and no multi-select', () => {
    const {quick, picker} = sceneOf();
    pickValue(screenOf(), quick, NEVER).catch(() => undefined);
    const screen = picker();
    deepStrictEqual(
      [screen.title, screen.placeholder, screen.buttons, screen.canSelectMany],
      [
        'Add Dev Container Configuration Files',
        'Flavour:',
        [BACK_BUTTON],
        false,
      ],
    );
  });

  it('F-0803 AC-2, AC-32: on a template’s screen the default is first, tagged (default) and focused, and the others keep their order', () => {
    const {quick, picker} = sceneOf();
    pickValue(screenOf(), quick, NEVER).catch(() => undefined);
    const screen = picker();
    deepStrictEqual(
      [
        screen.labels(),
        screen.items.map(row => row.description),
        screen.activeItems.map(row => row.label),
      ],
      [['b', 'a', 'c'], ['(default)', undefined, undefined], ['b']],
    );
  });

  it('F-0803 BR-4: on a Feature’s screen the default is tagged where the schema has it, and the first row is focused', () => {
    const {quick, picker} = sceneOf();
    pickValue(screenOf({defaultFirst: false}), quick, NEVER).catch(
      () => undefined,
    );
    const screen = picker();
    deepStrictEqual(
      [
        screen.labels(),
        screen.items.map(row => row.description),
        screen.activeItems.map(row => row.label),
      ],
      [['a', 'b', 'c'], [undefined, '(default)', undefined], ['a']],
    );
  });

  it('F-0803 5.0 step 3: accepting a row gives its value', async () => {
    const {quick, picker} = sceneOf();
    const answer = pickValue(screenOf(), quick, NEVER);
    picker().accept('c');
    deepStrictEqual(await answer, {kind: 'value', value: 'c'});
  });

  it('F-0803 AC-30: of values that all match, typed text that is not one adds the Use row after them, and the first match stays focused', () => {
    const {quick, picker} = sceneOf();
    const screen = screenOf({
      values: ['3.10', '3.11', '3.12'],
      defaultValue: undefined,
      strict: false,
    });
    pickValue(screen, quick, NEVER).catch(() => undefined);
    picker().type('3.1');
    deepStrictEqual(
      [
        picker().labels(),
        picker().items.map(row => row.description),
        picker().activeItems.map(row => row.label),
      ],
      [
        ['3.10', '3.11', '3.12', 'Use: 3.1'],
        [undefined, undefined, undefined, '(custom)'],
        ['3.10'],
      ],
    );
  });

  it('F-0803 AC-30: typed text that matches no value focuses the Use row alone', () => {
    const {quick, picker} = sceneOf();
    pickValue(screenOf({strict: false}), quick, NEVER).catch(() => undefined);
    picker().type('zz');
    deepStrictEqual(
      [picker().labels().at(-1), picker().activeItems.map(row => row.label)],
      ['Use: zz', ['Use: zz']],
    );
  });

  it('F-0803 AC-30: typed text that is exactly a value, or nothing typed, adds no Use row', () => {
    const {quick, picker} = sceneOf();
    pickValue(screenOf({strict: false}), quick, NEVER).catch(() => undefined);
    const initial = picker().labels();
    picker().type('c');
    deepStrictEqual(
      [initial, picker().labels()],
      [
        ['b', 'a', 'c'],
        ['b', 'a', 'c'],
      ],
    );
  });

  it('F-0803 AC-18: accepting the Use row gives the typed text verbatim', async () => {
    const {quick, picker} = sceneOf();
    const answer = pickValue(screenOf({strict: false}), quick, NEVER);
    picker().type('my motto');
    picker().acceptFocused();
    deepStrictEqual(await answer, {kind: 'value', value: 'my motto'});
  });

  it('F-0803 AC-29: a strict screen has no Use row, and Enter with no row to take keeps it open', async () => {
    const {quick, picker} = sceneOf();
    const answer = pickValue(screenOf(), quick, NEVER);
    picker().type('zzz');
    picker().acceptNothing();
    const stillOpen = picker().hidden === false;
    picker().accept('c');
    deepStrictEqual(
      [picker().labels(), stillOpen, await answer],
      [['b', 'a', 'c'], true, {kind: 'value', value: 'c'}],
    );
  });

  it('F-0803 BR-14: the Back button gives back, and another button does nothing', async () => {
    const {quick, picker} = sceneOf();
    const answer = pickValue(screenOf(), quick, NEVER);
    picker().trigger({name: 'other'});
    const stillOpen = picker().hidden === false;
    picker().trigger(BACK_BUTTON);
    deepStrictEqual([stillOpen, await answer], [true, {kind: 'back'}]);
  });

  it('F-0803 BR-9: closing the screen gives escape, and so does the wizard being cancelled', async () => {
    const closed = sceneOf();
    const first = pickValue(screenOf(), closed.quick, NEVER);
    closed.picker().hide();
    const aborting = new AbortController();
    const second = sceneOf();
    const other = pickValue(screenOf(), second.quick, aborting.signal);
    aborting.abort();
    deepStrictEqual(await Promise.all([first, other]), [
      {kind: 'escape'},
      {kind: 'escape'},
    ]);
  });
});

/** A boolean screen of two items, the first checked. */
const BOOLEANS: BooleanScreen = {
  title: 'Add Dev Container Configuration Files',
  placeholder: "Select the options for the 'Lab' dev container",
  items: [
    {key: 'withDocs', label: 'With docs', checked: true},
    {key: 'withTests', label: 'With tests', checked: false},
  ],
};

describe('the boolean screen of a template (card containers-87)', () => {
  it('F-0803 AC-5, BR-3: the items start checked as their defaults say, none is tagged (default), and the screen is a multi-select with a Back button', () => {
    const {quick, picker} = sceneOf();
    pickBooleans(BOOLEANS, quick, NEVER).catch(() => undefined);
    const screen = picker();
    deepStrictEqual(
      [
        screen.canSelectMany,
        screen.buttons,
        screen.placeholder,
        screen.labels(),
        screen.items.map(row => row.description),
        screen.selectedItems.map(row => row.label),
      ],
      [
        true,
        [BACK_BUTTON],
        "Select the options for the 'Lab' dev container",
        ['With docs', 'With tests'],
        [undefined, undefined],
        ['With docs'],
      ],
    );
  });

  it('F-0803 6.1 step 3: OK gives the keys of the checked items', async () => {
    const {quick, picker} = sceneOf();
    const answer = pickBooleans(BOOLEANS, quick, NEVER);
    picker().acceptChecked(['With tests']);
    deepStrictEqual(await answer, {
      kind: 'values',
      checked: new Set(['withTests']),
    });
  });

  it('F-0803 BR-14, BR-9: Back gives back and closing gives escape', async () => {
    const backed = sceneOf();
    const first = pickBooleans(BOOLEANS, backed.quick, NEVER);
    backed.picker().trigger(BACK_BUTTON);
    const closed = sceneOf();
    const second = pickBooleans(BOOLEANS, closed.quick, NEVER);
    closed.picker().hide();
    deepStrictEqual(await Promise.all([first, second]), [
      {kind: 'back'},
      {kind: 'escape'},
    ]);
  });
});
