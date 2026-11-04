import {deepStrictEqual} from 'node:assert';
import {
  type BoxCounter,
  pausableTimer,
} from '../../src/engine/pausable-timer.ts';

/** A clock the test moves, and boxes it opens and closes. */
function sceneOf() {
  let now = 0;
  const timers: Array<{due: number; callback: () => void; live: boolean}> = [];
  const listeners = new Set<(open: number) => void>();
  const state = {open: 0};
  const boxes: BoxCounter = {
    openBoxes: () => state.open,
    onBoxes: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  function setTimer(milliseconds: number, callback: () => void): () => void {
    const timer = {due: now + milliseconds, callback, live: true};
    timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  function advance(milliseconds: number): void {
    now += milliseconds;
    for (const timer of timers) {
      if (timer.live && timer.due <= now) {
        timer.live = false;
        timer.callback();
      }
    }
  }
  function setBoxes(open: number): void {
    state.open = open;
    for (const listener of listeners) {
      listener(open);
    }
  }
  return {boxes, setTimer, advance, setBoxes, listeners};
}

describe('the timer of a query that waits for a person (card containers-172, §2)', () => {
  it('F-0205 BR-15: with no box the timer fires at its time, once', () => {
    const scene = sceneOf();
    const fired: number[] = [];
    pausableTimer(scene.setTimer, 100, () => fired.push(1), scene.boxes);
    scene.advance(99);
    const early = fired.length;
    scene.advance(1);
    scene.advance(500);
    deepStrictEqual([early, fired.length], [0, 1]);
  });

  it('F-0205 BR-15: a box that opens stops the timer, and the last box that closes starts it again with its full time', () => {
    const scene = sceneOf();
    const fired: number[] = [];
    pausableTimer(scene.setTimer, 100, () => fired.push(1), scene.boxes);
    scene.advance(60);
    scene.setBoxes(1);
    scene.advance(10_000);
    const whileOpen = fired.length;
    scene.setBoxes(2);
    scene.setBoxes(1);
    scene.advance(10_000);
    const whileOneIsLeft = fired.length;
    scene.setBoxes(0);
    scene.advance(99);
    const beforeFull = fired.length;
    scene.advance(1);
    deepStrictEqual(
      [whileOpen, whileOneIsLeft, beforeFull, fired.length],
      [0, 0, 0, 1],
    );
  });

  it('F-0205 BR-15: a box already open at the start holds the timer back until it closes', () => {
    const scene = sceneOf();
    scene.setBoxes(1);
    const fired: number[] = [];
    pausableTimer(scene.setTimer, 100, () => fired.push(1), scene.boxes);
    scene.advance(1000);
    const held = fired.length;
    scene.setBoxes(0);
    scene.advance(100);
    deepStrictEqual([held, fired.length], [0, 1]);
  });

  it('F-0205 BR-15: cancelling stops the timer and the listening, and without boxes it is the plain timer', () => {
    const scene = sceneOf();
    const fired: number[] = [];
    const cancel = pausableTimer(
      scene.setTimer,
      100,
      () => fired.push(1),
      scene.boxes,
    );
    cancel();
    scene.setBoxes(1);
    scene.setBoxes(0);
    scene.advance(1000);
    const plain = sceneOf();
    pausableTimer(plain.setTimer, 50, () => fired.push(2), undefined);
    plain.advance(50);
    deepStrictEqual([fired, scene.listeners.size], [[2], 0]);
  });
});
