import {deepStrictEqual, rejects} from 'node:assert';
import {
  answerSettled,
  type InputBoxFacts,
  type SettledAnswerPorts,
} from '../tests/acceptance/windows/settled-answer.ts';

const CLOSED: InputBoxFacts = {
  open: false,
  value: '',
  message: '',
  validating: false,
  focused: false,
};

/** An open box holding `value`, validating or not. */
function boxWith(value: string, validating = false): InputBoxFacts {
  return {open: true, value, message: '', validating, focused: true};
}

/**
 * Ports over a script of the box: `script` gives what the box shows at each read after the previous action, a clock
 * that each sleep advances, and the actions the answer took, in order.
 */
function portsOver(script: {
  /** The reads before the text is typed. */
  before: readonly InputBoxFacts[];
  /** The reads after it, until the first Enter. */
  typed: readonly InputBoxFacts[];
  /** The reads after the first Enter, until a second one. */
  entered: readonly InputBoxFacts[];
}): SettledAnswerPorts & {actions: string[]} {
  let phase: 'before' | 'typed' | 'entered' = 'before';
  let clock = 0;
  const reads = {before: 0, typed: 0, entered: 0};
  const ports = {
    actions: [] as string[],
    facts: () => {
      const list = script[phase];
      const facts = list[Math.min(reads[phase], list.length - 1)] ?? CLOSED;
      reads[phase] += 1;
      return Promise.resolve(facts);
    },
    type: (text: string) => {
      ports.actions.push(`type ${text}`);
      phase = 'typed';
      return Promise.resolve();
    },
    enter: () => {
      ports.actions.push('enter');
      phase = 'entered';
      return Promise.resolve();
    },
    sleep: (milliseconds: number) => {
      clock += milliseconds;
      return Promise.resolve();
    },
    now: () => clock,
  };
  return ports;
}

describe('the answer to an input box that validates what it is given (card #2754)', () => {
  it('#2754: it types the text, waits until the validation has finished, and only then presses Enter', async () => {
    const ports = portsOver({
      before: [boxWith('')],
      typed: [boxWith('8080', true), boxWith('8080', true), boxWith('8080')],
      entered: [CLOSED],
    });
    await answerSettled(ports, '8080');
    deepStrictEqual(ports.actions, ['type 8080', 'enter']);
  });

  it('#2754: it waits for the box to open before it types', async () => {
    const ports = portsOver({
      before: [CLOSED, CLOSED, boxWith('')],
      typed: [boxWith('8080')],
      entered: [CLOSED],
    });
    await answerSettled(ports, '8080');
    deepStrictEqual(ports.actions, ['type 8080', 'enter']);
  });

  it('#2754: an Enter the box did not take, still open with the text in it, is pressed once more', async () => {
    const ports = portsOver({
      before: [boxWith('')],
      typed: [boxWith('8080')],
      entered: [boxWith('8080')],
    });
    await answerSettled(ports, '8080');
    deepStrictEqual(ports.actions, ['type 8080', 'enter', 'enter']);
  });

  it('#2754: a box that closes after the first Enter gets no second one', async () => {
    const ports = portsOver({
      before: [boxWith('')],
      typed: [boxWith('8080')],
      entered: [boxWith('8080'), CLOSED],
    });
    await answerSettled(ports, '8080');
    deepStrictEqual(ports.actions, ['type 8080', 'enter']);
  });

  it('#2754: a box that opens no input fails with what it showed', async () => {
    await rejects(
      answerSettled(
        portsOver({before: [CLOSED], typed: [], entered: []}),
        '8080',
      ),
      /no input box opened to answer: \{"open":false/u,
    );
  });

  it('#2754: a box that does not take the text, or never finishes validating it, fails with what it showed and presses no Enter', async () => {
    const stuck = portsOver({
      before: [boxWith('')],
      typed: [boxWith('8080', true)],
      entered: [],
    });
    const lost = portsOver({
      before: [boxWith('')],
      typed: [boxWith('')],
      entered: [],
    });
    const failures = await Promise.all(
      [stuck, lost].map(ports =>
        answerSettled(ports, '8080').then(
          () => 'answered',
          (caught: unknown) => (caught as Error).message,
        ),
      ),
    );
    deepStrictEqual(
      [failures, stuck.actions, lost.actions],
      [
        [
          'the input box did not take "8080" and settle: {"open":true,"value":"8080","message":"","validating":true,"focused":true}',
          'the input box did not take "8080" and settle: {"open":true,"value":"","message":"","validating":false,"focused":true}',
        ],
        ['type 8080'],
        ['type 8080'],
      ],
    );
  });
});
