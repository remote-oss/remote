import {strictEqual} from 'node:assert';
import {escapeControls} from '../../src/index.ts';

describe('escapeControls (card log-04 table)', () => {
  it('a C1 and a C0 control in a text -> each written as its code point', () => {
    strictEqual(escapeControls('a\u009bb\u0007'), 'a\\u{9b}b\\u{7}');
  });

  it('U+0000 -> \\u{0}', () => {
    strictEqual(escapeControls('\u0000'), '\\u{0}');
  });

  it('U+0008 -> \\u{8}, the last control before the tab', () => {
    strictEqual(escapeControls('\u0008'), '\\u{8}');
  });

  it('U+000B -> \\u{b}, the first control after the line feed', () => {
    strictEqual(escapeControls('\u000b'), '\\u{b}');
  });

  it('U+000D -> \\u{d}', () => {
    strictEqual(escapeControls('\r'), '\\u{d}');
  });

  it('U+001F -> \\u{1f}, the last C0 control', () => {
    strictEqual(escapeControls('\u001f'), '\\u{1f}');
  });

  it('U+0080 -> \\u{80}, the first C1 control', () => {
    strictEqual(escapeControls('\u0080'), '\\u{80}');
  });

  it('U+009F -> \\u{9f}, the last C1 control', () => {
    strictEqual(escapeControls('\u009f'), '\\u{9f}');
  });

  it('a tab and a line feed -> kept', () => {
    strictEqual(escapeControls('a\tb\nc'), 'a\tb\nc');
  });

  it('DEL, a space and a no-break space -> kept', () => {
    strictEqual(escapeControls('\u007f  '), '\u007f  ');
  });

  it('a character outside the basic plane -> kept', () => {
    strictEqual(escapeControls('a\u{1f600}b'), 'a\u{1f600}b');
  });

  it('a text with no control -> the same string', () => {
    strictEqual(escapeControls('host a'), 'host a');
  });

  it('the empty string -> the empty string', () => {
    strictEqual(escapeControls(''), '');
  });
});
