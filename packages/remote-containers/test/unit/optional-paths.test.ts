import {deepStrictEqual} from 'node:assert';
import {
  askOptionalPaths,
  type OptionalPathsAnswer,
} from '../../src/authoring/optional-paths.ts';
import {
  BACK_BUTTON,
  checking,
  pressBack,
  pressEscape,
  scriptedInput,
  type FakeOptionPicker,
  type Step,
} from './option-picker.fixture.ts';

const NEVER = new AbortController().signal;

const PATHS = ['zeta.txt', 'docs/*', 'alpha.txt'];

/** Runs the stage over `PATHS` with the one screen played by `step`. */
async function asked(
  step: Step,
): Promise<{answer: OptionalPathsAnswer; picker: FakeOptionPicker}> {
  const input = scriptedInput([step]);
  const answer = await askOptionalPaths(
    PATHS,
    {...input.ports, translate: text => text},
    NEVER,
  );
  const [picker] = input.pickers;
  if (picker === undefined) {
    throw new Error('no screen was shown');
  }
  return {answer, picker};
}

describe('the optional files and directories (card containers-90)', () => {
  it('F-0805 AC-1, AC-2, AC-16: the screen is a multi-select titled and placed as specified, with the entries as the template names them, in its order, none checked or focused, Back the only title button, and it stays open when the focus leaves', async () => {
    const {picker} = await asked(pressEscape);
    deepStrictEqual(
      {
        title: picker.title,
        placeholder: picker.placeholder,
        canSelectMany: picker.canSelectMany,
        items: picker.items.map(each => ({...each})),
        selected: picker.selectedItems.length,
        active: picker.activeItems.length,
        buttons: picker.buttons,
        ignoreFocusOut: picker.ignoreFocusOut,
      },
      {
        title: 'Optional Files/Directories',
        placeholder: 'Include the following optional files/directories',
        canSelectMany: true,
        items: PATHS.map(path => ({label: path, value: path})),
        selected: 0,
        active: 0,
        buttons: [BACK_BUTTON],
        ignoreFocusOut: true,
      },
    );
  });

  it('F-0805 AC-4, AC-13: OK with some entries checked leaves out the others, in the template’s order', async () => {
    deepStrictEqual((await asked(checking(['alpha.txt']))).answer, {
      kind: 'chosen',
      omitPaths: ['zeta.txt', 'docs/*'],
    });
  });

  it('F-0805 AC-5: OK with nothing checked leaves out every entry', async () => {
    deepStrictEqual((await asked(checking([]))).answer, {
      kind: 'chosen',
      omitPaths: PATHS,
    });
  });

  it('F-0805 AC-17: every entry checked leaves none out, whatever the filter hid when OK was pressed', async () => {
    deepStrictEqual(
      (
        await asked(picker => {
          picker.type('zz');
          picker.acceptChecked(PATHS);
        })
      ).answer,
      {kind: 'chosen', omitPaths: []},
    );
  });

  it('F-0801 AC-42, F-0805 AC-21: Escape includes every entry', async () => {
    deepStrictEqual((await asked(pressEscape)).answer, {
      kind: 'chosen',
      omitPaths: [],
    });
  });

  it('F-0805 AC-18: Back is answered as back', async () => {
    deepStrictEqual((await asked(pressBack)).answer, {kind: 'back'});
  });
});
