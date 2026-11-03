import {deepStrictEqual, strictEqual} from 'node:assert';
import {inspect} from 'node:util';
import {PromptBook} from '../../src/index.ts';

describe('open questions (F-2102 BR-4)', () => {
  it('numbers questions from 1 and lists the open ones oldest first', () => {
    const book = new PromptBook();
    book.open('maskedInput', 'Password:');
    book.open('fingerprintPick', 'Continue connecting?');
    deepStrictEqual(
      book.pending().map(prompt => [prompt.promptId, prompt.surface]),
      [
        [1, 'maskedInput'],
        [2, 'fingerprintPick'],
      ],
    );
  });

  it('hands the first answer to the delivery and closes the question', () => {
    const book = new PromptBook();
    const asked = book.open('maskedInput', 'Password:');
    const delivered: string[] = [];
    const accepted = book.answer(asked.promptId, 'secret', text =>
      delivered.push(text),
    );
    deepStrictEqual(
      [accepted, delivered, book.pending()],
      [true, ['secret'], []],
    );
  });

  it('closes the question before delivering, so an answer is lost when the delivery throws', () => {
    const book = new PromptBook();
    const asked = book.open('maskedInput', 'Password:');
    let thrown: unknown;
    try {
      book.answer(asked.promptId, 'lost', () => {
        throw new Error('delivery failed');
      });
    } catch (caught) {
      thrown = caught;
    }
    deepStrictEqual(
      [thrown instanceof Error ? thrown.message : thrown, book.pending()],
      ['delivery failed', []],
    );
  });

  it('refuses a second answer to the same question, delivering nothing', () => {
    const book = new PromptBook();
    const asked = book.open('maskedInput', 'Password:');
    book.answer(asked.promptId, 'first', () => undefined);
    const delivered: string[] = [];
    deepStrictEqual(
      [
        book.answer(asked.promptId, 'second', text => delivered.push(text)),
        delivered,
      ],
      [false, []],
    );
  });

  it('refuses an answer to a question that was never asked', () => {
    strictEqual(
      new PromptBook().answer(9, 'x', () => undefined),
      false,
    );
  });

  it('keeps no answer: the text exists only in the delivery', () => {
    const book = new PromptBook();
    const asked = book.open('maskedInput', 'Password:');
    book.answer(asked.promptId, 'hunter2-answer', () => undefined);
    strictEqual(
      inspect(book, {depth: null, showHidden: true}).includes('hunter2-answer'),
      false,
    );
  });

  it('shows a text that is stored, which proves the check above can fail', () => {
    const stored = new Map([[1, 'hunter2-answer']]);
    strictEqual(
      inspect(stored, {depth: null}).includes('hunter2-answer'),
      true,
    );
  });

  it('closes every open question when the login ends, and says which', () => {
    const book = new PromptBook();
    book.open('maskedInput', 'Password:');
    book.open('maskedInput', 'Again:');
    deepStrictEqual([book.closeAll(), book.pending()], [[1, 2], []]);
  });
});
