import {deepStrictEqual} from 'node:assert';
import {effectiveAction} from '../../src/shutdown/effective-action.ts';

describe('the effective shutdownAction (card containers-68)', () => {
  it('F-0417 AC-1, AC-3: with no value anywhere an image or Dockerfile configuration stops', () => {
    deepStrictEqual(
      [effectiveAction(undefined, undefined), effectiveAction([], undefined)],
      ['stop', 'stop'],
    );
  });

  it('F-0417 AC-2, AC-9: stopContainer and stopCompose both stop, on either kind', () => {
    deepStrictEqual(
      [
        effectiveAction(undefined, 'stopContainer'),
        effectiveAction(undefined, 'stopCompose'),
        effectiveAction([{shutdownAction: 'stopCompose'}], undefined),
      ],
      ['stop', 'stop', 'stop'],
    );
  });

  it('F-0417 AC-5, AC-6: the image’s none holds unless a later entry sets a stop value', () => {
    deepStrictEqual(
      [
        effectiveAction([{shutdownAction: 'none'}], undefined),
        effectiveAction(
          [{shutdownAction: 'none'}, {shutdownAction: 'stopContainer'}],
          undefined,
        ),
      ],
      ['none', 'stop'],
    );
  });

  it('F-0417 AC-7, AC-8: the recorded value wins over a later edit of the file, both ways', () => {
    deepStrictEqual(
      [
        effectiveAction([{shutdownAction: 'none'}], undefined),
        effectiveAction([{remoteUser: 'node'}], 'none'),
        effectiveAction([{shutdownAction: 'stopContainer'}], 'none'),
      ],
      ['none', 'stop', 'stop'],
    );
  });

  it('F-0417 AC-9, AC-65: a value that is not one of the two stop values means none', () => {
    deepStrictEqual(
      [
        effectiveAction(undefined, 'none'),
        effectiveAction(undefined, 'keepRunning'),
        effectiveAction([{shutdownAction: 'keepRunning'}], undefined),
      ],
      ['none', 'none', 'none'],
    );
  });

  it('F-0417 AC-67, AC-69: a label whose entries have no shutdownAction gives the default, whatever the file says', () => {
    deepStrictEqual(
      [
        effectiveAction([{remoteUser: 'vscode'}, {features: {}}], 'none'),
        effectiveAction(undefined, 'none'),
      ],
      ['stop', 'none'],
    );
  });

  it('F-0417 AC-70: null, false, 0 and the empty string count as an absent key; every other value means none', () => {
    deepStrictEqual(
      [
        [null, false, 0, ''].map(value => effectiveAction(undefined, value)),
        [1, true, 'x', {}, []].map(value => effectiveAction(undefined, value)),
      ],
      [
        ['stop', 'stop', 'stop', 'stop'],
        ['none', 'none', 'none', 'none', 'none'],
      ],
    );
  });

  it('F-0417 BR-2: the last entry with the key decides, and an entry that is not an object is ignored', () => {
    deepStrictEqual(
      [
        effectiveAction(
          [{shutdownAction: 'stopContainer'}, {shutdownAction: 'none'}, {}],
          undefined,
        ),
        effectiveAction(
          [{shutdownAction: 'none'}, 'text', null, [1], {shutdownAction: null}],
          undefined,
        ),
        effectiveAction(['text', null, [1]], 'none'),
      ],
      ['none', 'stop', 'stop'],
    );
  });
});
