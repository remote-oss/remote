import {deepStrictEqual} from 'node:assert';
import type {CatalogueTemplate} from '../../src/authoring/catalogue.ts';
import {
  askTemplateOptions,
  type OptionsAnswer,
} from '../../src/authoring/template-options.ts';
import {
  checking,
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

/** A template with an enum option, one with proposals, a plain string, and two booleans. */
const OPTIONS_LAB: CatalogueTemplate = {
  id: 'ghcr.io/example/templates/options-lab',
  version: '1',
  name: 'Options Lab',
  owner: 'example',
  options: {
    flavour: {
      type: 'string',
      enum: ['a', 'b', 'c'],
      default: 'b',
      description: 'Flavour:',
    },
    channel: {
      type: 'string',
      proposals: ['stable', 'edge'],
      default: 'stable',
      description: 'Channel:',
    },
    motto: {type: 'string', default: 'hello'},
    withDocs: {type: 'boolean', default: true, description: 'With docs'},
    withTests: {type: 'boolean', default: false},
  },
  optionalPaths: [],
};

/** The stage over a scripted quick input: `steps` play the user on each screen it shows, in turn. */
async function ranStage(
  template: CatalogueTemplate,
  steps: Step[],
): Promise<{result: OptionsAnswer; screens: FakeOptionPicker[]}> {
  const input = scriptedInput(steps);
  const result = await askTemplateOptions(
    template,
    {
      title: 'Add Dev Container Configuration Files',
      quick: {...input.ports, translate: (text: string) => text},
    },
    NEVER,
  );
  return {result, screens: input.pickers};
}

/** The arguments a finished stage gives, or what it ended with. */
function argsOf(result: OptionsAnswer): unknown {
  return result.kind === 'chosen' ? result.templateArgs : result.kind;
}

const DEFAULTS: Step[] = [
  takeDefaults,
  takeDefaults,
  takeDefaults,
  takeDefaults,
];

describe('the template options stage (card containers-87)', () => {
  it('F-0803 AC-7: a template that declares no option shows nothing, and gives no arguments', async () => {
    const {result, screens} = await ranStage({...OPTIONS_LAB, options: {}}, []);
    deepStrictEqual(
      [result, screens.length],
      [{kind: 'chosen', templateArgs: {}, shown: false}, 0],
    );
  });

  it('F-0803 AC-1, BR-2: every string option has a screen first, in schema order, then one screen for the booleans, and the placeholders are the descriptions, S307 when there is none, and S317', async () => {
    const {screens} = await ranStage(OPTIONS_LAB, [...DEFAULTS]);
    deepStrictEqual(
      screens.map(each => [each.title, each.placeholder, each.canSelectMany]),
      [
        ['Add Dev Container Configuration Files', 'Flavour:', false],
        ['Add Dev Container Configuration Files', 'Channel:', false],
        ['Add Dev Container Configuration Files', 'Select a value', false],
        [
          'Add Dev Container Configuration Files',
          "Select the options for the 'Options Lab' dev container",
          true,
        ],
      ],
    );
  });

  it('F-0803 AC-2, AC-31, AC-32: the screens list an enum’s values, a proposals list, and a plain string’s default alone, each with its default first', async () => {
    const {screens} = await ranStage(OPTIONS_LAB, [...DEFAULTS]);
    deepStrictEqual(
      screens.slice(0, 3).map(each => each.labels()),
      [['b', 'a', 'c'], ['stable', 'edge'], ['hello']],
    );
  });

  it('F-0803 AC-5: the boolean screen’s items are the descriptions, or the keys, and start checked as their defaults say', async () => {
    const {screens} = await ranStage(OPTIONS_LAB, [...DEFAULTS]);
    const booleans = screens[3];
    deepStrictEqual(
      [booleans?.labels(), booleans?.selectedItems.map(each => each.label)],
      [['With docs', 'withTests'], ['With docs']],
    );
  });

  it('F-0803 AC-17: the defaults give each string as it is and each boolean as the string true or false', async () => {
    const {result} = await ranStage(OPTIONS_LAB, [...DEFAULTS]);
    deepStrictEqual(argsOf(result), {
      flavour: 'b',
      channel: 'stable',
      motto: 'hello',
      withDocs: 'true',
      withTests: 'false',
    });
  });

  it('F-0803 AC-17, AC-18: a picked value, typed text on a proposals and a plain-string screen, and a boolean checked are the arguments, verbatim', async () => {
    const {result} = await ranStage(OPTIONS_LAB, [
      pick('c'),
      typeAndAcceptFocused('edge2'),
      typeAndAcceptFocused('my motto'),
      checking(['withTests']),
    ]);
    deepStrictEqual(argsOf(result), {
      flavour: 'c',
      channel: 'edge2',
      motto: 'my motto',
      withDocs: 'false',
      withTests: 'true',
    });
  });

  it('F-0803 AC-5, AC-17: a boolean whose default is the string true or false, as the published templates write it, starts checked or not by that string and is given as true or false', async () => {
    const {result, screens} = await ranStage(
      {
        ...OPTIONS_LAB,
        options: {
          installZsh: {type: 'boolean', default: 'true', description: 'ZSH'},
          upgrade: {type: 'boolean', default: 'false', description: 'Upgrade'},
        },
      },
      [takeDefaults],
    );
    deepStrictEqual(
      [screens[0]?.selectedItems.map(each => each.label), argsOf(result)],
      [['ZSH'], {installZsh: 'true', upgrade: 'false'}],
    );
  });

  it('F-0803 AC-19: Escape on the boolean screen goes on with nothing checked', async () => {
    const {result} = await ranStage(OPTIONS_LAB, [
      takeDefaults,
      takeDefaults,
      takeDefaults,
      pressEscape,
    ]);
    deepStrictEqual(argsOf(result), {
      flavour: 'b',
      channel: 'stable',
      motto: 'hello',
      withDocs: 'false',
      withTests: 'false',
    });
  });

  it('F-0803 AC-20: Escape on a string screen cancels the wizard', async () => {
    const {result} = await ranStage(OPTIONS_LAB, [pressEscape]);
    deepStrictEqual(result, {kind: 'cancelled'});
  });

  it('F-0803 AC-24: Back from the boolean screen reopens the last string screen fresh, its first item focused, and the others are asked again after it', async () => {
    const {result, screens} = await ranStage(OPTIONS_LAB, [
      pick('a'),
      takeDefaults,
      pick('hello'),
      pressBack,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(
      [
        screens.length,
        screens[4]?.placeholder,
        screens[4]?.activeItems.map(each => each.label),
        argsOf(result),
      ],
      [
        6,
        'Select a value',
        ['hello'],
        {
          flavour: 'a',
          channel: 'stable',
          motto: 'hello',
          withDocs: 'true',
          withTests: 'false',
        },
      ],
    );
  });

  it('F-0803 AC-24: Back from a string screen goes to the one before it, which opens with its default focused again', async () => {
    const {screens} = await ranStage(OPTIONS_LAB, [
      pick('a'),
      pressBack,
      takeDefaults,
      takeDefaults,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(
      [
        screens[2]?.placeholder,
        screens[2]?.activeItems.map(each => each.label),
      ],
      ['Flavour:', ['b']],
    );
  });

  it('F-0803 BR-14: Back from the first screen gives Back to the stage before, with no answer kept', async () => {
    const {result} = await ranStage(OPTIONS_LAB, [pressBack]);
    deepStrictEqual(result, {kind: 'back'});
  });

  it('F-0803 BR-14: Back from the boolean screen of a template with only booleans gives Back to the stage before', async () => {
    const {result, screens} = await ranStage(
      {
        ...OPTIONS_LAB,
        options: {
          withDocs: {type: 'boolean', default: true, description: 'With docs'},
        },
      },
      [pressBack],
    );
    deepStrictEqual([result, screens.length], [{kind: 'back'}, 1]);
  });

  it('F-0803 AC-29: Enter on a strict enum screen with typed text that matches no value keeps it open, and the text is never an argument', async () => {
    const {result, screens} = await ranStage(OPTIONS_LAB, [
      picker => {
        picker.type('zzz');
        picker.acceptNothing();
        picker.accept('c');
      },
      takeDefaults,
      takeDefaults,
      takeDefaults,
    ]);
    deepStrictEqual(
      [screens[0]?.labels(), JSON.stringify(argsOf(result)).includes('zzz')],
      [['b', 'a', 'c'], false],
    );
  });

  it('F-0803 6.4: a plain string with no default has an empty list and S307 for an empty description, and the text typed is its value', async () => {
    const {result, screens} = await ranStage(
      {
        ...OPTIONS_LAB,
        options: {name: {type: 'string', description: ''}},
      },
      [typeAndAcceptFocused('abc')],
    );
    deepStrictEqual(
      [screens[0]?.placeholder, argsOf(result)],
      ['Select a value', {name: 'abc'}],
    );
  });

  it('F-0803 6.1: an option that is neither a string nor a boolean has no screen and no argument', async () => {
    const {result, screens} = await ranStage(
      {
        ...OPTIONS_LAB,
        options: {
          retries: {type: 'number', default: 3},
          weird: 'not an object',
          listed: ['not an object either'],
          flavour: OPTIONS_LAB.options.flavour,
        },
      },
      [takeDefaults],
    );
    deepStrictEqual([screens.length, argsOf(result)], [1, {flavour: 'b'}]);
  });
});
