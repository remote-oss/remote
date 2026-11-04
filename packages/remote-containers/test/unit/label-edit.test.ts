import {deepStrictEqual} from 'node:assert';
import {labelEdit} from '../../src/ports/label-edit.ts';

/** The `portsAttributes` member of an edited text. */
function attributesOf(text: string | undefined): Record<string, unknown> {
  const parsed = JSON.parse(text ?? '{}') as {
    portsAttributes: Record<string, unknown>;
  };
  return parsed.portsAttributes;
}

/** The name of the error `edit` throws, none when it throws nothing. */
function errorOf(edit: () => unknown): string | undefined {
  try {
    edit();
    return undefined;
  } catch (failure) {
    return (failure as Error).name;
  }
}

describe('the label of a port in portsAttributes (card containers-210, F-1103 BR-6)', () => {
  it('F-1103 AC-4, AC-9 (c210-new): a port with no entry gains one with its label, an empty label is written as an empty string, and every other byte stays', () => {
    const text = '{\n  // the image\n  "image": "a",\n  "name": "x"\n}\n';
    deepStrictEqual(
      [labelEdit(text, 3000, 'web'), labelEdit(text, 3000, '')],
      [
        '{\n  // the image\n  "image": "a",\n  "name": "x",\n  "portsAttributes": {\n    "3000": {\n      "label": "web"\n    }\n  }\n}\n',
        '{\n  // the image\n  "image": "a",\n  "name": "x",\n  "portsAttributes": {\n    "3000": {\n      "label": ""\n    }\n  }\n}\n',
      ],
    );
  });

  it('F-1103 AC-21 (c210-order): the keys read the numbers first, ascending, then the others in their order, and every untouched value stays', () => {
    const text =
      '{"portsAttributes": {"localhost:8765": {"label": "a"}, "3000-3010": {"label": "b"}, "3006": {"label": "c"}}}';
    const attributes = attributesOf(labelEdit(text, 3005, 'new'));
    deepStrictEqual(
      [
        Object.keys(attributes),
        attributes['3006'],
        attributes['localhost:8765'],
      ],
      [
        ['3005', '3006', 'localhost:8765', '3000-3010'],
        {label: 'c'},
        {label: 'a'},
      ],
    );
  });

  it('F-1103 AC-22 (c210-range): a range key that covers the port keeps its label, and the port gets an entry of its own beside it', () => {
    const edited = labelEdit(
      '{"portsAttributes": {"3000-3010": {"label": "r"}}}',
      3005,
      'p',
    );
    deepStrictEqual(attributesOf(edited), {
      '3005': {label: 'p'},
      '3000-3010': {label: 'r'},
    });
  });

  it('F-1103 AC-4 (c210-existing): an entry keeps its other attributes when its label changes, and the same label is no change', () => {
    const text =
      '{"portsAttributes": {"3000": {"onAutoForward": "silent", "label": "old"}}}';
    deepStrictEqual(
      [
        attributesOf(labelEdit(text, 3000, 'new')),
        labelEdit(text, 3000, 'old'),
      ],
      [{'3000': {onAutoForward: 'silent', label: 'new'}}, undefined],
    );
  });

  it('F-1103 AC-4 (c210-entry-not-object): an entry that is no object is replaced by one that holds the label', () => {
    deepStrictEqual(
      attributesOf(labelEdit('{"portsAttributes": {"3000": 5}}', 3000, 'x')),
      {'3000': {label: 'x'}},
    );
  });

  it('F-1103 BR-6 (c210-refusals): text that is no object and a portsAttributes that is no object are refused', () => {
    deepStrictEqual(
      [
        errorOf(() => labelEdit('[]', 1, 'a')),
        errorOf(() => labelEdit('{"portsAttributes": []}', 1, 'a')),
        errorOf(() => labelEdit('{"portsAttributes": null}', 1, 'a')),
      ],
      [
        'NotAnObjectError',
        'PortsAttributesNotAnObjectError',
        'PortsAttributesNotAnObjectError',
      ],
    );
  });
});
