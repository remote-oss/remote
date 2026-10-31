import {deepStrictEqual} from 'node:assert';
import type {CatalogueFeature} from '../../src/authoring/catalogue.ts';
import {
  askFeatures,
  featureKeyOf,
  finishTooltip,
  sortedFeatures,
} from '../../src/authoring/select-features.ts';
import {
  BACK_BUTTON,
  FINISH_BUTTON,
  type FakeOptionPicker,
  pressBack,
  pressEscape,
  scriptedInput,
  type Step,
  VERIFIED_ICON,
} from './option-picker.fixture.ts';

const NEVER = new AbortController().signal;

/** A Feature of the catalogue with the fields the screen reads. */
function featureOf(
  name: string,
  owner: string | undefined,
  version = '1.0.0',
): CatalogueFeature {
  return {
    id: `ghcr.io/x/features/${name.toLowerCase().replaceAll(' ', '-')}`,
    version,
    name,
    ...(owner === undefined ? {} : {owner}),
    options: {},
  };
}

const FEATURES = [
  featureOf('Lab Options', 'remote-oss-run'),
  featureOf('Git', 'devcontainers', '1.3.2'),
  featureOf('apt-get packages', 'someone'),
  featureOf('Docker (Docker-in-Docker)', 'devcontainers', '2.12.0'),
  featureOf('Lab Plain', 'remote-oss-run'),
  featureOf('Unowned', undefined, '10.1.0'),
];

/** The step that checks `labels` and presses the title-bar Finish. */
function finishWith(labels: readonly string[]): Step {
  return picker => {
    picker.selectedItems = picker.items.filter(each =>
      labels.includes(each.label),
    );
    picker.trigger(FINISH_BUTTON);
  };
}

/** The step that checks `labels` and presses OK. */
function okWith(labels: readonly string[]): Step {
  return picker => {
    picker.acceptChecked(labels);
  };
}

/** Asks for the Features over a script of one screen, and gives the answer with the screen. */
async function asked(
  step: Step,
  previous: Parameters<typeof askFeatures>[1] = [],
  features: readonly CatalogueFeature[] = FEATURES,
): Promise<{
  answer: Awaited<ReturnType<typeof askFeatures>>;
  screen: FakeOptionPicker | undefined;
}> {
  const input = scriptedInput([step]);
  const answer = await askFeatures(
    features,
    previous,
    {quick: {...input.ports, translate: template => template}},
    NEVER,
  );
  return {answer, screen: input.pickers[0]};
}

describe('Select Features (card containers-88)', () => {
  it('F-0804 BR-2, AC-25: the Features are listed by label ignoring case, and labels equal ignoring case by code units', () => {
    deepStrictEqual(
      sortedFeatures([
        featureOf('git', undefined),
        featureOf('Git', undefined),
        featureOf('Zed', undefined),
        featureOf('Git', undefined),
        featureOf('apt-get packages', undefined),
        featureOf('Lab Plain', undefined),
        featureOf('Lab Options', undefined),
      ]).map(each => each.name),
      [
        'apt-get packages',
        'Git',
        'Git',
        'git',
        'Lab Options',
        'Lab Plain',
        'Zed',
      ],
    );
  });

  it('F-0804 BR-8: a Feature is written under its id and the major of its version', () => {
    deepStrictEqual(
      [
        featureOf('Git', undefined, '1.3.2'),
        featureOf('Unowned', undefined, '10.1.0'),
        featureOf('Odd', undefined, ''),
      ].map(featureKeyOf),
      [
        'ghcr.io/x/features/git:1',
        'ghcr.io/x/features/unowned:10',
        'ghcr.io/x/features/odd:',
      ],
    );
  });

  it('F-0804 AC-1: the screen is titled S301, holds S308 and lets the user pick several, with Back and Finish in its title bar', async () => {
    const {screen} = await asked(pressEscape);
    deepStrictEqual(
      [
        screen?.title,
        screen?.placeholder,
        screen?.canSelectMany,
        screen?.buttons,
      ],
      [
        'Select Features',
        'Select additional features to install',
        true,
        [BACK_BUTTON, FINISH_BUTTON],
      ],
    );
  });

  it('F-0804 BR-3, AC-2: a Feature shows its owner, and the verified icon exactly when the owner is devcontainers', async () => {
    const {screen} = await asked(pressEscape);
    deepStrictEqual(
      screen?.items.map(each => [each.label, each.description, each.iconPath]),
      [
        ['apt-get packages', 'someone', undefined],
        ['Docker (Docker-in-Docker)', 'devcontainers', VERIFIED_ICON],
        ['Git', 'devcontainers', VERIFIED_ICON],
        ['Lab Options', 'remote-oss-run', undefined],
        ['Lab Plain', 'remote-oss-run', undefined],
        ['Unowned', undefined, undefined],
      ],
    );
  });

  it('F-0804 BR-5, AC-3: filtering matches the label only, so neither the description nor the detail is searched', async () => {
    const {screen} = await asked(pressEscape);
    deepStrictEqual(
      [screen?.matchOnDescription, screen?.matchOnDetail],
      [false, false],
    );
  });

  it('F-0804 BR-6, BR-10, AC-4, AC-17: the list has no row for typed text and nothing is checked', async () => {
    const {screen} = await asked(pressEscape);
    deepStrictEqual(
      [screen?.items.some(each => each.custom === true), screen?.selectedItems],
      [false, []],
    );
  });

  it('F-0804 BR-11, AC-5: Finish ends with the checked Features in the list’s order, each with no options, and the mode defaults', async () => {
    const {answer} = await asked(finishWith(['Git', 'Lab Options']));
    deepStrictEqual(answer, {
      kind: 'chosen',
      features: [
        {id: 'ghcr.io/x/features/git:1', options: {}},
        {id: 'ghcr.io/x/features/lab-options:1', options: {}},
      ],
      mode: 'defaults',
    });
  });

  it('F-0804 AC-5: OK ends with the same Features and the mode configure', async () => {
    const {answer} = await asked(
      okWith(['Lab Plain', 'Docker (Docker-in-Docker)']),
    );
    deepStrictEqual(answer, {
      kind: 'chosen',
      features: [
        {id: 'ghcr.io/x/features/docker-(docker-in-docker):2', options: {}},
        {id: 'ghcr.io/x/features/lab-plain:1', options: {}},
      ],
      mode: 'configure',
    });
  });

  it('F-0804 AC-5: with nothing checked Finish and OK both give no Feature', async () => {
    deepStrictEqual(
      [(await asked(finishWith([]))).answer, (await asked(okWith([]))).answer],
      [
        {kind: 'chosen', features: [], mode: 'defaults'},
        {kind: 'chosen', features: [], mode: 'configure'},
      ],
    );
  });

  it('F-0804 AC-16: Escape cancels the wizard', async () => {
    deepStrictEqual((await asked(pressEscape)).answer, {kind: 'cancelled'});
  });

  it('F-0804 BR-7, AC-26: Back goes back', async () => {
    deepStrictEqual((await asked(pressBack)).answer, {kind: 'back'});
  });

  it('F-0804 BR-9: coming back to the screen opens it with the Features checked before', async () => {
    const {screen} = await asked(pressEscape, [
      {id: 'ghcr.io/x/features/git:1', options: {}},
    ]);
    deepStrictEqual(
      screen?.selectedItems.map(each => each.label),
      ['Git'],
    );
  });

  it('F-0804 AC-1: the Finish button’s tooltip is its English text', () => {
    deepStrictEqual(
      finishTooltip(template => template),
      'Finish',
    );
  });
});
