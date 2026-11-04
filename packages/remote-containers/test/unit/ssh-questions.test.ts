import {deepStrictEqual} from 'node:assert';
import {
  createQuestionRouter,
  operationOf,
  type QuestionMode,
  type QuestionRouter,
} from '../../src/engine/ssh-questions.ts';

const PASSWORD = "pwuser@host's password: ";
const HOST_KEY =
  "The authenticity of host 'h (1.2.3.4)' can't be established.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? ";

/** One box the router opened: what it showed, and the way to close it. */
interface OpenedBox {
  prompt: string;
  masked: boolean;
  close(text: string | undefined): void;
}

/** A router over a window whose boxes the test closes, with what it opened and showed. */
function sceneOf(focused = true): {
  router: QuestionRouter;
  boxes: OpenedBox[];
  pointers: Array<Promise<void>>;
} {
  const boxes: OpenedBox[] = [];
  const pointers: Array<Promise<void>> = [];
  const router = createQuestionRouter({
    openBox: (prompt, masked) =>
      new Promise<string | undefined>(resolve => {
        boxes.push({prompt, masked, close: resolve});
      }),
    windowFocused: () => focused,
    pointAtBox: closed => {
      pointers.push(closed);
    },
    emptyPrompt: 'Enter password',
  });
  return {router, boxes, pointers};
}

/** Lets the promises that are ready run. */
function settled(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('the questions of an SSH Docker endpoint (card containers-172, §2)', () => {
  it('F-0205 AC-25, BR-14: an answer given once is given again at once with no box, for any mode, and the operation says it was replayed', async () => {
    const {router, boxes} = sceneOf();
    const first = router.ask(operationOf('command'), PASSWORD);
    await settled();
    boxes[0]?.close('secret');
    await first;
    const results = [];
    const operations = (['command', 'view', 'automatic'] as const).map(
      operationOf,
    );
    for (const operation of operations) {
      results.push(await router.ask(operation, PASSWORD));
    }
    deepStrictEqual(
      [
        results,
        boxes.length,
        operations.map(operation => operation.outcome.replayed),
      ],
      [Array(3).fill({kind: 'answer', text: 'secret'}), 1, [true, true, true]],
    );
  });

  it('F-0205 BR-14: an empty answer is an answer, and a wrong one is remembered as given', async () => {
    const {router, boxes} = sceneOf();
    const empty = router.ask(operationOf('view'), 'Enter passphrase: ');
    await settled();
    boxes[0]?.close('');
    const wrong = router.ask(operationOf('view'), PASSWORD);
    await settled();
    boxes[1]?.close('wrong');
    deepStrictEqual(
      [
        await empty,
        await wrong,
        await router.ask(operationOf('view'), PASSWORD),
        boxes.length,
      ],
      [
        {kind: 'answer', text: ''},
        {kind: 'answer', text: 'wrong'},
        {kind: 'answer', text: 'wrong'},
        2,
      ],
    );
  });

  it('F-0205 AC-26, BR-14: a box closed without Enter is a decline, refused at once afterwards with no new box, and the first asker is refused too', async () => {
    const {router, boxes} = sceneOf();
    const first = operationOf('view');
    const asked = router.ask(first, PASSWORD);
    await settled();
    boxes[0]?.close(undefined);
    const second = operationOf('view');
    deepStrictEqual(
      [
        await asked,
        await router.ask(second, PASSWORD),
        boxes.length,
        first.outcome,
        second.outcome,
      ],
      [
        {kind: 'refused', reason: 'declined'},
        {kind: 'refused', reason: 'declined'},
        1,
        {
          boxClosed: true,
          refused: false,
          replayed: false,
          declinedApplied: false,
        },
        {
          boxClosed: false,
          refused: true,
          replayed: false,
          declinedApplied: true,
        },
      ],
    );
  });

  it('F-0205 BR-4: two questions of one text share one box and get the one answer, and two texts get two boxes', async () => {
    const {router, boxes} = sceneOf();
    const operation = operationOf('command');
    const one = router.ask(operation, PASSWORD);
    const two = router.ask(operation, PASSWORD);
    const other = router.ask(operation, 'Enter passphrase for key: ');
    await settled();
    const opened = boxes.map(box => box.prompt);
    boxes[0]?.close('shared');
    boxes[1]?.close('other');
    deepStrictEqual(
      [opened, await one, await two, await other],
      [
        [PASSWORD, 'Enter passphrase for key: '],
        {kind: 'answer', text: 'shared'},
        {kind: 'answer', text: 'shared'},
        {kind: 'answer', text: 'other'},
      ],
    );
  });

  it('F-0205 BR-20, 7.E8: an automatic operation with no remembered answer is refused at once with no box, and marked', async () => {
    const {router, boxes} = sceneOf();
    const operation = operationOf('automatic');
    deepStrictEqual(
      [
        await router.ask(operation, PASSWORD),
        boxes.length,
        operation.outcome.refused,
        operation.outcome.boxClosed,
      ],
      [{kind: 'refused', reason: 'noAnswer'}, 0, true, false],
    );
  });

  it('F-0205 BR-20: an automatic operation joins a box that a command opened, and takes its answer', async () => {
    const {router, boxes} = sceneOf();
    const opened = router.ask(operationOf('command'), PASSWORD);
    const joined = router.ask(operationOf('automatic'), PASSWORD);
    await settled();
    boxes[0]?.close('typed');
    deepStrictEqual(
      [await opened, await joined, boxes.length],
      [{kind: 'answer', text: 'typed'}, {kind: 'answer', text: 'typed'}, 1],
    );
  });

  it('F-0205 AC-3, AC-22, AC-53: a password box is masked, a host-key box is plain text, and a question with no text shows the empty prompt, masked', async () => {
    const {router, boxes} = sceneOf();
    void router.ask(operationOf('command'), PASSWORD);
    void router.ask(operationOf('command'), HOST_KEY);
    void router.ask(operationOf('command'), '');
    await settled();
    deepStrictEqual(
      boxes.map(box => [box.prompt, box.masked]),
      [
        [PASSWORD, true],
        [HOST_KEY, false],
        ['Enter password', true],
      ],
    );
  });

  it('F-0205 AC-54, BR-4: an unfocused window points at a box once, however many questions join it, and the pointer ends when the box closes; a focused one never does', async () => {
    const unfocused = sceneOf(false);
    void unfocused.router.ask(operationOf('command'), PASSWORD);
    void unfocused.router.ask(operationOf('command'), PASSWORD);
    await settled();
    let ended = false;
    void unfocused.pointers[0]?.then(() => {
      ended = true;
    });
    await settled();
    const beforeClose = ended;
    unfocused.boxes[0]?.close('x');
    await settled();
    const focused = sceneOf(true);
    void focused.router.ask(operationOf('command'), PASSWORD);
    await settled();
    deepStrictEqual(
      [unfocused.pointers.length, beforeClose, ended, focused.pointers.length],
      [1, false, true, 0],
    );
  });

  it('F-0205 BR-15: a question that is dropped leaves its box open, and an answer typed later is still remembered', async () => {
    const {router, boxes} = sceneOf();
    void router.ask(operationOf('command'), PASSWORD);
    await settled();
    const openWhileDropped = router.openBoxes();
    boxes[0]?.close('late');
    await settled();
    deepStrictEqual(
      [openWhileDropped, router.openBoxes(), router.remembers(PASSWORD)],
      [1, 0, {kind: 'answer', text: 'late'}],
    );
  });

  it('F-0205 BR-15: the listeners hear the count of open boxes as it changes, until they stop', async () => {
    const {router, boxes} = sceneOf();
    const heard: number[] = [];
    const stop = router.onBoxes(open => heard.push(open));
    void router.ask(operationOf('command'), PASSWORD);
    await settled();
    boxes[0]?.close('a');
    await settled();
    stop();
    void router.ask(operationOf('command'), HOST_KEY);
    await settled();
    deepStrictEqual(heard, [1, 0]);
  });

  it('F-0205 BR-20: the three modes are the three the card names', () => {
    const modes: QuestionMode[] = ['command', 'view', 'automatic'];
    deepStrictEqual(
      modes.map(mode => operationOf(mode).mode),
      ['command', 'view', 'automatic'],
    );
  });
});
