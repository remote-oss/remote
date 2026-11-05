import {deepStrictEqual} from 'node:assert';
import {
  addExtensionEdit,
  NotAnArrayError,
} from '../../src/authoring/add-extension.ts';
import {NotAnObjectError} from '../../src/config/jsonc-edit.ts';

/** What a call gave: the new text, none for a duplicate, or the name of the error it threw. */
function outcomeOf(text: string, extensionId: string): string | undefined {
  try {
    return addExtensionEdit(text, extensionId);
  } catch (failure) {
    if (failure instanceof NotAnObjectError) {
      return 'NotAnObjectError';
    }
    return failure instanceof NotAnArrayError
      ? `NotAnArrayError ${failure.list}`
      : 'another error';
  }
}

describe('the edit of Add to devcontainer.json (card containers-207, brief-authoring-edits §3)', () => {
  it('F-0809 AC-4 (c207-create): a configuration with no extensions gets customizations.vscode.extensions with the extensionId alone', () => {
    deepStrictEqual(
      outcomeOf('{\n  "name": "x"\n}', 'ms.tool'),
      '{\n  "name": "x",\n  "customizations": {\n    "vscode": {\n      "extensions": [\n        "ms.tool"\n      ]\n    }\n  }\n}',
    );
  });

  it('F-0809 AC-7, AC-8, AC-14 (c207-where): the id goes to the customizations array when there is one, else to the top-level array, and only to the first when both exist', () => {
    const nested =
      '{\n  "customizations": {\n    "vscode": {\n      "extensions": ["a.b"]\n    }\n  }\n}';
    const legacy = '{\n  "extensions": ["a.b"]\n}';
    const both =
      '{\n  "extensions": ["a.b"],\n  "customizations": {"vscode": {"extensions": ["c.d"]}}\n}';
    function added(text: string): string | undefined {
      return outcomeOf(text, 'x.y');
    }
    deepStrictEqual(
      [
        added(nested)?.includes(
          '"extensions": [\n        "a.b",\n        "x.y"\n      ]',
        ) ?? false,
        added(legacy),
        added(both)?.startsWith('{\n  "extensions": ["a.b"],'),
        added(both)?.includes('"c.d",\n'),
      ],
      [true, '{\n  "extensions": [\n    "a.b",\n    "x.y"\n  ]\n}', true, true],
    );
  });

  it('F-0809 AC-6, AC-41, AC-29 (c207-duplicate): an id either array holds literally is no change, and an opt-out entry is not the id', () => {
    deepStrictEqual(
      [
        outcomeOf(
          '{"customizations": {"vscode": {"extensions": ["x.y"]}}}',
          'x.y',
        ),
        outcomeOf(
          '{"extensions": ["x.y"], "customizations": {"vscode": {"extensions": ["a.b"]}}}',
          'x.y',
        ),
        outcomeOf('{"extensions": ["-x.y"]}', 'x.y')?.includes('"x.y"\n'),
        outcomeOf('{"extensions": ["X.Y"]}', 'x.y')?.includes('"x.y"'),
      ],
      [undefined, undefined, true, true],
    );
  });

  it('F-0809 AC-6 (c207-entries): entries of a list that are not strings are no id, and a string among them still counts', () => {
    deepStrictEqual(
      [
        outcomeOf('{"extensions": [1, null, "a.b"]}', 'x.y')?.includes('"x.y"'),
        outcomeOf('{"extensions": [1, "x.y"]}', 'x.y'),
      ],
      [true, undefined],
    );
  });

  it('F-0809 AC-16, AC-24 (c207-formatting): tabs, comments and their commas are kept', () => {
    const text = '{\n\t// before\n\t"extensions": [\n\t\t"a.b" // last\n\t]\n}';
    deepStrictEqual(
      outcomeOf(text, 'x.y'),
      '{\n\t// before\n\t"extensions": [\n\t\t"a.b",\n\t\t"x.y" // last\n\t]\n}',
    );
  });

  it('F-0809 AC-39, AC-40 (c207-broken): text that is no object, or a list that is no array, is an error, and a missing comma is edited around', () => {
    deepStrictEqual(
      [
        outcomeOf('not json', 'x.y'),
        outcomeOf('[]', 'x.y'),
        outcomeOf('{"extensions": "x"}', 'x.y'),
        outcomeOf('{"customizations": {"vscode": {"extensions": {}}}}', 'x.y'),
        outcomeOf('{\n  "name": "x"\n  "image": "y"\n}', 'x.y')?.includes(
          '"image": "y"',
        ),
      ],
      [
        'NotAnObjectError',
        'NotAnObjectError',
        'NotAnArrayError extensions',
        'NotAnArrayError customizations.vscode.extensions',
        true,
      ],
    );
  });
});
