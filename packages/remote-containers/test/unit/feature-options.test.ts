import {deepStrictEqual} from 'node:assert';
import type {CatalogueFeature} from '../../src/authoring/catalogue.ts';
import {
  askFeatureOptions,
  type ChosenFeature,
  type FeatureOptionsAnswer,
} from '../../src/authoring/feature-options.ts';
import {
  checking,
  FINISH_BUTTON,
  type FakeOptionPicker,
  pressBack,
  pressEscape,
  pick,
  scriptedInput,
  type Step,
  takeDefaults,
  typeAndAcceptFocused,
} from './option-picker.fixture.ts';

const NEVER = new AbortController().signal;

/** A Feature with two booleans (one with no description), an enum, a proposals list and a plain string. */
const LAB_OPTIONS: CatalogueFeature = {
  id: 'ghcr.io/example/features/lab-options',
  version: '1.0.0',
  name: 'Lab Options',
  options: {
    enabled: {type: 'boolean', default: true, description: 'Enable it'},
    verbose: {type: 'boolean', default: false},
    level: {
      type: 'string',
      enum: ['low', 'high'],
      default: 'low',
      description: 'Level:',
    },
    tone: {
      type: 'string',
      proposals: ['calm', 'bright'],
      default: 'bright',
      description: 'Tone:',
    },
    installPath: {type: 'string', default: '/opt'},
  },
};

/** A Feature whose only option is a proposals list. */
const GIT_FEATURE: CatalogueFeature = {
  id: 'ghcr.io/example/features/git',
  version: '1.3.2',
  name: 'Git',
  options: {
    version: {
      type: 'string',
      proposals: ['latest', 'os-provided'],
      default: 'latest',
      description: 'Version:',
    },
    extras: {type: 'string', proposals: ['a', 'b'], description: 'PPA:'},
  },
};

/** A Feature that declares no option. */
const PLAIN: CatalogueFeature = {
  id: 'ghcr.io/example/features/lab-plain',
  version: '2.0.0',
  name: 'Lab Plain',
  options: {},
};

/** A Feature with a plain string option only: it is walked and gets no screen. */
const PATHS: CatalogueFeature = {
  id: 'ghcr.io/example/features/paths',
  version: '1.0.0',
  name: 'Paths',
  options: {installPath: {type: 'string', default: '/opt'}},
};

/** The Features as the stage after Select Features gets them, with their keys. */
function chosenOf(...features: CatalogueFeature[]): ChosenFeature[] {
  return features.map(feature => ({
    choice: {
      id: `${feature.id}:${feature.version.split('.')[0] ?? ''}`,
      options: {},
    },
    feature,
  }));
}

/** The stage over a scripted quick input: `steps` play the user on each screen it shows, in turn. */
async function ranStage(
  chosen: ChosenFeature[],
  steps: Step[],
  configure = true,
): Promise<{result: FeatureOptionsAnswer; screens: FakeOptionPicker[]}> {
  const input = scriptedInput(steps);
  const result = await askFeatureOptions(
    chosen,
    configure,
    {...input.ports, translate: (text: string) => text},
    NEVER,
  );
  return {result, screens: input.pickers};
}

/** The entries a finished stage gives, by the name of the Feature's key, or what it ended with. */
function entriesOf(result: FeatureOptionsAnswer): unknown {
  return result.kind === 'chosen'
    ? result.features.map(each => [each.id.split('/').pop(), each.options])
    : result.kind;
}

/** The step that presses the Finish button of the screen. */
function finishing(picker: FakeOptionPicker): void {
  picker.trigger(FINISH_BUTTON);
}

const CONFIGURE = pick('Configure Options');

describe('the Features’ options stage (card containers-89)', () => {
  it('F-0803 BR-5, AC-8: with Finish on Select Features nothing is asked and every Feature is {}', async () => {
    const {result, screens} = await ranStage(
      chosenOf(LAB_OPTIONS, GIT_FEATURE),
      [],
      false,
    );
    deepStrictEqual(
      [
        entriesOf(result),
        result.kind === 'chosen' && result.shown,
        screens.length,
      ],
      [
        [
          ['lab-options:1', {}],
          ['git:1', {}],
        ],
        false,
        0,
      ],
    );
  });

  it('F-0803 AC-9, BR-5: OK with no Feature that declares an option shows nothing and every Feature is {}', async () => {
    const {result, screens} = await ranStage(chosenOf(PLAIN), []);
    deepStrictEqual(
      [
        entriesOf(result),
        result.kind === 'chosen' && result.shown,
        screens.length,
      ],
      [[['lab-plain:2', {}]], false, 0],
    );
  });

  it('F-0803 AC-10: the gate is titled S217, has no placeholder and no title-bar button, and lists Keep Defaults focused, then Configure Options', async () => {
    const {screens} = await ranStage(chosenOf(LAB_OPTIONS), [
      pick('Keep Defaults'),
    ]);
    const [gate] = screens;
    deepStrictEqual(
      [
        gate?.title,
        gate?.placeholder,
        gate?.buttons,
        gate?.labels(),
        gate?.activeItems.map(each => each.label),
      ],
      [
        'Keep Feature defaults or configure options?',
        '',
        [],
        ['Keep Defaults', 'Configure Options'],
        ['Keep Defaults'],
      ],
    );
  });

  it('F-0803 AC-11, BR-5: Keep Defaults writes every Feature as {}, those with no option included, and walks nothing', async () => {
    const {result, screens} = await ranStage(chosenOf(LAB_OPTIONS, PLAIN), [
      pick('Keep Defaults'),
    ]);
    deepStrictEqual(
      [
        entriesOf(result),
        result.kind === 'chosen' && result.shown,
        screens.length,
      ],
      [
        [
          ['lab-options:1', {}],
          ['lab-plain:2', {}],
        ],
        true,
        1,
      ],
    );
  });

  it('F-0803 BR-9, AC-19: Escape on the gate goes on to Configure Options', async () => {
    const {result, screens} = await ranStage(chosenOf(GIT_FEATURE), [
      pressEscape,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual([screens.length, result.kind], [3, 'chosen']);
  });

  it('F-0803 AC-12, BR-6: Configure Options walks only the Features that declare an option', async () => {
    const {screens} = await ranStage(chosenOf(PLAIN, GIT_FEATURE, PATHS), [
      CONFIGURE,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(
      screens.slice(1).map(each => each.title),
      ["Select options for 'Git'", "Select options for 'Git'"],
    );
  });

  it('F-0803 AC-13, AC-14: the boolean screen comes first, titled S310 and S311 with the name, with the raw keys, the descriptions only where there are some, and the defaults checked', async () => {
    const {screens} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      takeDefaults,
      takeDefaults,
    ]);
    const booleans = screens[1];
    deepStrictEqual(
      [
        booleans?.title,
        booleans?.placeholder,
        booleans?.canSelectMany,
        booleans?.items.map(each => [each.label, each.description]),
        booleans?.selectedItems.map(each => each.label),
        booleans?.buttons,
      ],
      [
        "Select boolean options for 'Lab Options'",
        'Select boolean options for Lab Options',
        true,
        [
          ['enabled', 'Enable it'],
          ['verbose', undefined],
        ],
        ['enabled'],
        [{name: 'back'}, FINISH_BUTTON],
      ],
    );
  });

  it('F-0803 AC-15, AC-32: each string option with a list gets a screen in schema order, strict for an enum, the default tagged and not first, the description as the placeholder and Finish beside Back', async () => {
    const {screens} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      takeDefaults,
      takeDefaults,
    ]);
    const [, , level, tone] = screens;
    deepStrictEqual(
      [
        screens.length,
        level?.title,
        level?.placeholder,
        level?.items.map(each => [each.label, each.description]),
        level?.buttons,
        tone?.placeholder,
        tone?.items.map(each => [each.label, each.description]),
        tone?.activeItems.map(each => each.label),
      ],
      [
        4,
        "Select options for 'Lab Options'",
        'Level:',
        [
          ['low', '(default)'],
          ['high', undefined],
        ],
        [{name: 'back'}, FINISH_BUTTON],
        'Tone:',
        [
          ['calm', undefined],
          ['bright', '(default)'],
        ],
        ['calm'],
      ],
    );
  });

  it('F-0803 AC-16, AC-28, BR-7, BR-16: a boolean is written only when checked, a string whenever its screen was shown, and a plain string never', async () => {
    const {result} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      checking(['enabled']),
      pick('high'),
      pick('bright'),
    ]);
    deepStrictEqual(entriesOf(result), [
      ['lab-options:1', {enabled: true, level: 'high', tone: 'bright'}],
    ]);
  });

  it('F-0803 BR-7: a string at its default is written, and an unchecked boolean is absent', async () => {
    const {result} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      checking([]),
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(entriesOf(result), [
      ['lab-options:1', {level: 'low', tone: 'calm'}],
    ]);
  });

  it('F-0803 AC-18, AC-30: text typed on a proposals screen is written as typed', async () => {
    const {result} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      takeDefaults,
      typeAndAcceptFocused('breezy'),
    ]);
    deepStrictEqual(entriesOf(result), [
      ['lab-options:1', {enabled: true, level: 'low', tone: 'breezy'}],
    ]);
  });

  it('F-0803 AC-29: Enter on a strict screen with text that matches nothing keeps it open', async () => {
    const {result, screens} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      picker => {
        picker.type('zzz');
        picker.acceptFocused();
        picker.hide();
      },
    ]);
    deepStrictEqual([screens.length, result.kind], [3, 'cancelled']);
  });

  it('F-0803 AC-26, AC-27, BR-15: Finish on a value screen counts its focused value, omits the options not yet shown, and the walk goes on with the next Feature', async () => {
    const {result, screens} = await ranStage(
      chosenOf(GIT_FEATURE, LAB_OPTIONS),
      [CONFIGURE, finishing, checking(['verbose']), takeDefaults, takeDefaults],
    );
    deepStrictEqual(
      [entriesOf(result), screens.length],
      [
        [
          ['git:1', {version: 'latest'}],
          ['lab-options:1', {verbose: true, level: 'low', tone: 'calm'}],
        ],
        5,
      ],
    );
  });

  it('F-0803 AC-26: Finish on a value screen with nothing focused leaves that option out', async () => {
    const {result} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      picker => {
        picker.type('zzz');
        picker.trigger(FINISH_BUTTON);
      },
    ]);
    deepStrictEqual(entriesOf(result), [['lab-options:1', {enabled: true}]]);
  });

  it('F-0803 BR-15: Finish on a proposals screen counts the text typed there, never confirmed with Enter', async () => {
    const {result} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      takeDefaults,
      picker => {
        picker.type('breezy');
        picker.trigger(FINISH_BUTTON);
      },
    ]);
    deepStrictEqual(entriesOf(result), [
      ['lab-options:1', {enabled: true, level: 'low', tone: 'breezy'}],
    ]);
  });

  it('F-0803 BR-15: Finish on a boolean screen is OK, and the Feature’s value screens follow', async () => {
    const {result, screens} = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      finishing,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(
      [entriesOf(result), screens.length],
      [[['lab-options:1', {enabled: true, level: 'low', tone: 'calm'}]], 4],
    );
  });

  it('F-0804 AC-19, BR-11: the Features are walked in the order given, whatever order they were checked in', async () => {
    const {screens} = await ranStage(chosenOf(GIT_FEATURE, LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      takeDefaults,
      takeDefaults,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(
      screens.slice(1).map(each => each.title),
      [
        "Select options for 'Git'",
        "Select options for 'Git'",
        "Select boolean options for 'Lab Options'",
        "Select options for 'Lab Options'",
        "Select options for 'Lab Options'",
      ],
    );
  });

  it('F-0803 AC-21, BR-9: Escape on a value screen, or on a boolean screen, in the walk ends the wizard', async () => {
    const onValue = await ranStage(chosenOf(GIT_FEATURE), [
      CONFIGURE,
      pressEscape,
    ]);
    const onBooleans = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      pressEscape,
    ]);
    deepStrictEqual(
      [onValue.result.kind, onBooleans.result.kind],
      ['cancelled', 'cancelled'],
    );
  });

  it('F-0803 AC-25, BR-14: Back on a screen of the walk, a boolean or a value one, gives back with nothing kept', async () => {
    const onValue = await ranStage(chosenOf(GIT_FEATURE), [
      CONFIGURE,
      pressBack,
    ]);
    const onBooleans = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      pressBack,
    ]);
    const later = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      takeDefaults,
      pressBack,
    ]);
    deepStrictEqual(
      [onValue.result.kind, onBooleans.result.kind, later.result.kind],
      ['back', 'back', 'back'],
    );
  });

  it('F-0803 BR-8: a screen starts from the schema’s defaults on every run, whatever an earlier run was answered', async () => {
    const first = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      checking(['verbose']),
      pick('high'),
      pick('bright'),
    ]);
    const second = await ranStage(chosenOf(LAB_OPTIONS), [
      CONFIGURE,
      pressEscape,
    ]);
    deepStrictEqual(
      [
        first.result.kind,
        second.screens[1]?.selectedItems.map(each => each.label),
      ],
      ['chosen', ['enabled']],
    );
  });

  it('F-0803 BR-3: a boolean whose default is the string true starts checked', async () => {
    const stringDefault: CatalogueFeature = {
      ...PLAIN,
      name: 'String Default',
      options: {flag: {type: 'boolean', default: 'true'}},
    };
    const {screens} = await ranStage(chosenOf(stringDefault), [
      CONFIGURE,
      takeDefaults,
    ]);
    deepStrictEqual(
      screens[1]?.selectedItems.map(each => each.label),
      ['flag'],
    );
  });

  it('F-0803 BR-16: a Feature with a plain string option only is walked and gets no screen, and its entry is {}', async () => {
    const {result, screens} = await ranStage(chosenOf(PATHS, GIT_FEATURE), [
      CONFIGURE,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(
      [entriesOf(result), screens.length],
      [
        [
          ['paths:1', {}],
          ['git:1', {version: 'latest', extras: 'a'}],
        ],
        3,
      ],
    );
  });
});
