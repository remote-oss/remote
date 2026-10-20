import {deepStrictEqual} from 'node:assert';
import {
  type CompanionId,
  createDetector,
  type ExtensionLookup,
  SSH_COMPANION_ID,
} from '../../src/index.ts';

/** A lookup over a set of present ids that counts what it is asked and what is disposed. */
interface FakeLookup extends ExtensionLookup {
  present: Set<string>;
  asked: string[];
  disposals: number;
  fire(): void;
}

function lookupWith(...installed: string[]): FakeLookup {
  const hooks: {listener?: () => void} = {};
  const lookup: FakeLookup = {
    present: new Set(installed),
    asked: [],
    disposals: 0,
    hasExtension: extensionId => {
      lookup.asked.push(extensionId);
      return lookup.present.has(extensionId);
    },
    onDidChange: given => {
      hooks.listener = given;
      return {
        dispose: () => {
          lookup.disposals += 1;
        },
      };
    },
    fire: () => {
      hooks.listener?.();
    },
  };
  return lookup;
}

/** The ids a listener was called with, in order. */
function recordingListener(): {
  calls: CompanionId[];
  listener: (companionId: CompanionId) => void;
} {
  const calls: CompanionId[] = [];
  return {
    calls,
    listener: companionId => {
      calls.push(companionId);
    },
  };
}

describe('the companion detector', () => {
  it('F-5902.5.detection: a companion present at creation is present twice over with one question to the editor', () => {
    const lookup = lookupWith(SSH_COMPANION_ID);
    const detector = createDetector(lookup);
    deepStrictEqual(
      [
        detector.isPresent(SSH_COMPANION_ID),
        detector.isPresent(SSH_COMPANION_ID),
        lookup.asked,
      ],
      ['present', 'present', [SSH_COMPANION_ID]],
    );
  });

  it('F-5101.AC-12: with nothing installed the companion is absent and the editor is asked at creation and at the call', () => {
    const lookup = lookupWith();
    const detector = createDetector(lookup);
    deepStrictEqual(
      [detector.isPresent(SSH_COMPANION_ID), lookup.asked.length],
      ['absent', 2],
    );
  });

  for (const installed of [
    ['ms-vscode-remote.remote-ssh'],
    ['ms-vscode-remote.remote-ssh', 'remote-oss.remote-ssh-edit'],
    ['REMOTE-OSS.remote-ssh'],
  ]) {
    it(`F-5101.AC-38: ${installed.join(' and ')} installed leaves the companion absent and asks only for the family id`, () => {
      const lookup = lookupWith(...installed);
      const detector = createDetector(lookup);
      deepStrictEqual(
        [detector.isPresent(SSH_COMPANION_ID), [...new Set(lookup.asked)]],
        ['absent', [SSH_COMPANION_ID]],
      );
    });
  }

  it('F-5101.AC-13, AC-26: a companion that arrives is announced once and then present without another question', () => {
    const lookup = lookupWith();
    const detector = createDetector(lookup);
    const heard = recordingListener();
    detector.onPresenceChanged(heard.listener);
    lookup.present.add(SSH_COMPANION_ID);
    lookup.fire();
    const askedBefore = lookup.asked.length;
    deepStrictEqual(
      [
        heard.calls,
        detector.isPresent(SSH_COMPANION_ID),
        lookup.asked.length - askedBefore,
      ],
      [[SSH_COMPANION_ID], 'present', 0],
    );
  });

  it('F-5101.AC-13: events with the companion still absent announce nothing, and the arrival announces once', () => {
    const lookup = lookupWith();
    const detector = createDetector(lookup);
    const heard = recordingListener();
    detector.onPresenceChanged(heard.listener);
    lookup.fire();
    lookup.fire();
    const beforeArrival = heard.calls.length;
    lookup.present.add(SSH_COMPANION_ID);
    lookup.fire();
    lookup.fire();
    deepStrictEqual([beforeArrival, heard.calls.length], [0, 1]);
  });

  it('F-5101.AC-25: a companion removed while the window runs stays present, announces nothing and is not asked again', () => {
    const lookup = lookupWith(SSH_COMPANION_ID);
    const detector = createDetector(lookup);
    const heard = recordingListener();
    detector.onPresenceChanged(heard.listener);
    const askedAtCreation = lookup.asked.length;
    lookup.present.delete(SSH_COMPANION_ID);
    lookup.fire();
    deepStrictEqual(
      [
        heard.calls,
        detector.isPresent(SSH_COMPANION_ID),
        lookup.asked.length - askedAtCreation,
      ],
      [[], 'present', 0],
    );
  });

  it('F-5101.AC-43: a new detector after a restart does not keep the removed companion', () => {
    const lookup = lookupWith(SSH_COMPANION_ID);
    createDetector(lookup);
    lookup.present.delete(SSH_COMPANION_ID);
    deepStrictEqual(
      createDetector(lookup).isPresent(SSH_COMPANION_ID),
      'absent',
    );
  });

  it('F-5101.BR-8: a companion found by a question counts as seen, so the event does not announce it', () => {
    const lookup = lookupWith();
    const detector = createDetector(lookup);
    const heard = recordingListener();
    detector.onPresenceChanged(heard.listener);
    const first = detector.isPresent(SSH_COMPANION_ID);
    lookup.present.add(SSH_COMPANION_ID);
    const second = detector.isPresent(SSH_COMPANION_ID);
    lookup.fire();
    deepStrictEqual([first, second, heard.calls], ['absent', 'present', []]);
  });

  it('F-5902.5.detection: a disposed listener is not called, and disposing it twice does no harm', () => {
    const lookup = lookupWith();
    const detector = createDetector(lookup);
    const first = recordingListener();
    const second = recordingListener();
    const registration = detector.onPresenceChanged(first.listener);
    detector.onPresenceChanged(second.listener);
    registration.dispose();
    registration.dispose();
    lookup.present.add(SSH_COMPANION_ID);
    lookup.fire();
    deepStrictEqual([first.calls, second.calls], [[], [SSH_COMPANION_ID]]);
  });

  it('F-5902.5.detection: listeners are called in the order they registered', () => {
    const lookup = lookupWith();
    const detector = createDetector(lookup);
    const order: string[] = [];
    detector.onPresenceChanged(() => {
      order.push('first');
    });
    detector.onPresenceChanged(() => {
      order.push('second');
    });
    lookup.present.add(SSH_COMPANION_ID);
    lookup.fire();
    deepStrictEqual(order, ['first', 'second']);
  });

  it('F-5902.5.detection: a detector disposed twice ends the editor subscription once and calls no listener after', () => {
    const lookup = lookupWith();
    const detector = createDetector(lookup);
    const heard = recordingListener();
    detector.onPresenceChanged(heard.listener);
    detector.dispose();
    detector.dispose();
    lookup.present.add(SSH_COMPANION_ID);
    lookup.fire();
    deepStrictEqual([lookup.disposals, heard.calls], [1, []]);
  });
});
