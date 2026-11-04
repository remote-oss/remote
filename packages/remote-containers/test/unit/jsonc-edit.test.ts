import {deepStrictEqual} from 'node:assert';
import {
  appendToArray,
  indentStepOf,
  lineEndsOf,
  NotAnObjectError,
  setProperty,
} from '../../src/config/jsonc-edit.ts';

describe('the JSONC writer (card containers-206, brief-authoring-edits §2)', () => {
  it('F-0809 BR-5 (c206-append-existing): a value is appended to an existing array after a comma, and a comment stays', () => {
    deepStrictEqual(
      [
        appendToArray('{\n  "a": [\n    "p"\n  ]\n}', ['a'], 'v'),
        appendToArray('{\n  "a": [\n    "p" // keep\n  ]\n}', ['a'], 'v'),
      ],
      [
        '{\n  "a": [\n    "p",\n    "v"\n  ]\n}',
        '{\n  "a": [\n    "p",\n    "v" // keep\n  ]\n}',
      ],
    );
  });

  it('F-0809 BR-5 (c206-append-empty): a value is appended to an empty array, keeping a comment after it', () => {
    deepStrictEqual(
      [
        appendToArray('{\n  "a": []\n}', ['a'], 'v'),
        appendToArray('{\n  "a": [] // c\n}', ['a'], 'v'),
      ],
      ['{\n  "a": [\n    "v"\n  ]\n}', '{\n  "a": [\n    "v"\n  ] // c\n}'],
    );
  });

  it('F-0809 BR-5 (c206-append-missing): a missing array is created with its parents, and the other keys stay', () => {
    deepStrictEqual(
      [
        appendToArray('{}', ['customizations', 'vscode', 'extensions'], 'v'),
        appendToArray('{"a":1}', ['x', 'y'], 'v'),
      ],
      [
        '{\n  "customizations": {\n    "vscode": {\n      "extensions": [\n        "v"\n      ]\n    }\n  }\n}',
        '{\n  "a": 1,\n  "x": {\n    "y": [\n      "v"\n    ]\n  }\n}',
      ],
    );
  });

  it('F-0809 BR-5 (c206-indent): the file’s own indentation and line ends are kept: tabs, two spaces, four spaces and CRLF', () => {
    deepStrictEqual(
      [
        appendToArray('{\n\t"a": [\n\t\t"p"\n\t]\n}', ['a'], 'v'),
        appendToArray('{\n  "a": [\n    "p"\n  ]\n}', ['a'], 'v'),
        appendToArray('{\n    "a": [\n        "p"\n    ]\n}', ['a'], 'v'),
        appendToArray('{\r\n  "a": [\r\n    "p"\r\n  ]\r\n}', ['a'], 'v'),
      ],
      [
        '{\n\t"a": [\n\t\t"p",\n\t\t"v"\n\t]\n}',
        '{\n  "a": [\n    "p",\n    "v"\n  ]\n}',
        '{\n    "a": [\n        "p",\n        "v"\n    ]\n}',
        '{\r\n  "a": [\r\n    "p",\r\n    "v"\r\n  ]\r\n}',
      ],
    );
  });

  it('F-0809 BR-5 (c206-set-property): a property is set when it is new and replaced when it exists, with the other bytes kept', () => {
    deepStrictEqual(
      [
        setProperty('{\n  // top\n  "a": 1\n}', ['b'], 'x'),
        setProperty('{\n  "a": 1, // one\n  "b": 2\n}', ['a'], 5),
        setProperty('{}', ['name'], 'n'),
      ],
      [
        '{\n  // top\n  "a": 1,\n  "b": "x"\n}',
        '{\n  "a": 5, // one\n  "b": 2\n}',
        '{\n  "name": "n"\n}',
      ],
    );
  });

  it('F-0809 BR-5 (c206-not-an-object): a text that is not an object throws NotAnObjectError, for an array, a number and a broken text', () => {
    function kindOf(change: () => string): string {
      try {
        change();
        return 'no error';
      } catch (failure) {
        return failure instanceof NotAnObjectError
          ? `${failure.name}: ${failure.message}`
          : 'another error';
      }
    }
    deepStrictEqual(
      ['[]', '1', 'nope', ''].map(text =>
        kindOf(() => appendToArray(text, ['a'], 'v')),
      ),
      Array<string>(4).fill('NotAnObjectError: the text is not a JSON object'),
    );
  });

  it('F-0809 BR-5 (c206-detection): the line ends are CRLF when the text has one, and the step is the first indented line’s', () => {
    deepStrictEqual(
      [
        lineEndsOf('a\r\nb'),
        lineEndsOf('a\nb'),
        indentStepOf('{\n\t"a": 1\n}'),
        indentStepOf('{"a": 1}'),
      ],
      ['\r\n', '\n', '\t', '  '],
    );
  });
});
