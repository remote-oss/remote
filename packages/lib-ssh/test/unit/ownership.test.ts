import {deepStrictEqual, strictEqual} from 'node:assert';
import {inspect} from 'node:util';
import {LoginOwnership, PromptBook} from '../../src/index.ts';

describe('login ownership (F-2102 BR-4, BR-5)', () => {
  let changes: number[];
  let ownership: LoginOwnership;

  beforeEach(() => {
    changes = [];
    ownership = new LoginOwnership(owner => changes.push(owner));
  });

  it('gives the login to the first lease', () => {
    ownership.leasesChanged([1]);
    deepStrictEqual([ownership.current(), changes], [1, [1]]);
  });

  it('keeps the owner when later leases arrive, and lists them as waiting, oldest first', () => {
    ownership.leasesChanged([1]);
    ownership.leasesChanged([1, 2, 3]);
    deepStrictEqual(
      [ownership.current(), ownership.waiting(), changes],
      [1, [2, 3], [1]],
    );
  });

  it('hands the login to the oldest waiting lease when the owner closes', () => {
    ownership.leasesChanged([1, 2, 3]);
    ownership.leasesChanged([2, 3]);
    deepStrictEqual([ownership.current(), changes], [2, [1, 2]]);
  });

  it('has no owner when the last lease closes, and the next lease takes the login', () => {
    ownership.leasesChanged([1]);
    ownership.leasesChanged([]);
    const afterLast = ownership.current();
    ownership.leasesChanged([4]);
    deepStrictEqual(
      [afterLast, ownership.current(), changes],
      [undefined, 4, [1, 4]],
    );
  });

  it('hands the login on when the owner gives up, while its lease stays', () => {
    ownership.leasesChanged([1, 2]);
    ownership.ownerGaveUp();
    deepStrictEqual(
      [ownership.current(), ownership.waiting(), changes],
      [2, [1], [1, 2]],
    );
  });

  it('does not give the login back to a lease that gave up when it is the only one left', () => {
    ownership.leasesChanged([1]);
    ownership.ownerGaveUp();
    deepStrictEqual([ownership.current(), changes], [undefined, [1]]);
  });

  it('forgets that a lease gave up once it has closed', () => {
    ownership.leasesChanged([1, 2]);
    ownership.ownerGaveUp();
    ownership.leasesChanged([2]);
    ownership.leasesChanged([2, 5]);
    ownership.ownerGaveUp();
    deepStrictEqual(ownership.current(), 5);
  });

  it('is told nothing when giving up with no owner', () => {
    ownership.ownerGaveUp();
    deepStrictEqual([ownership.current(), changes], [undefined, []]);
  });

  it('stops changing owners once the login is over', () => {
    ownership.leasesChanged([1, 2]);
    ownership.finish();
    ownership.leasesChanged([2]);
    deepStrictEqual([ownership.current(), changes], [1, [1]]);
  });

  it('copies the lease list it is given, so a later change of the array changes nothing', () => {
    const leaseIds = [1, 2];
    ownership.leasesChanged(leaseIds);
    leaseIds.shift();
    deepStrictEqual([ownership.waiting(), ownership.current()], [[2], 1]);
  });
});

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
