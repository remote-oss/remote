/**
 * @fileoverview display: the driver rows of the display and renderer modules, moved from the ssh-core acceptance file
 * to sit beside the modules they test, run on stand-in drivers.
 */

import {deepStrictEqual, rejects} from 'node:assert';
import {
  activateFrameWithin,
  activateWindowWithin,
  activeWindowNameOf,
  managedPick,
  topLevelWindowsOf,
  type KeyDriver,
} from '../tests/acceptance/windows/display.ts';
import {
  chooseQuickPickRow,
  focusWindow,
  type FocusReads,
} from '../tests/acceptance/windows/renderer.ts';

/** An activation that never settles; every other call is answered by `answer`, and `before` sees each call. */
function hangingActivationDriver(
  answer: (words: string[]) => string,
  before?: (words: string[]) => void,
): KeyDriver {
  return async (...words) => {
    before?.(words);
    if (words[0] === 'windowactivate') {
      await new Promise<string>(() => undefined);
      return '';
    }
    return answer(words);
  };
}

/** The reads of a focus row whose `driver` never confirms an activation, the page never holds the focus, and the display names the active window as `activeWindowName` says. */
function focusReadsOf(
  driver: KeyDriver,
  activeWindowName: () => Promise<string>,
  windowInstants?: FocusReads['windowInstants'],
): FocusReads {
  const reads: FocusReads = {
    activate: name =>
      activateWindowWithin(name, driver, 100, () => Promise.resolve(false)),
    pageHasFocus: () => Promise.resolve(false),
    activeWindowName,
  };
  if (windowInstants !== undefined) {
    reads.windowInstants = windowInstants;
  }
  return reads;
}

describe('the display and renderer driver rows (card #3010)', () => {
  it('card #3010 (c3010-focus-readout): a hanging driver stub times out and names the active window', async () => {
    // A driver whose `--sync` activation never settles: the display holds one window for the name, and its active window has a name, so the readout has something to name on every side.
    const activeName = 'the active window';
    const windowId = '98765';
    const driver = hangingActivationDriver(words =>
      words[0] === 'search'
        ? windowId
        : words[0] === 'getactivewindow'
          ? activeName
          : '',
    );
    const reads = focusReadsOf(driver, () => activeWindowNameOf(driver));
    let caught: unknown;
    try {
      await focusWindow('a window', reads, 1_000);
    } catch (error) {
      caught = error;
    }
    deepStrictEqual(
      [
        caught instanceof Error,
        caught instanceof Error &&
          caught.message.includes(`window ${windowId}`),
        caught instanceof Error && caught.message.includes('not confirmed'),
        caught instanceof Error && caught.message.includes(activeName),
      ],
      [true, true, true, true],
    );
  });

  it('card #3010 (c3010-managed-pick): the activation asks the manager for the last managed window, and the last of them while none is managed', () => {
    deepStrictEqual(
      [
        managedPick([]),
        managedPick([
          {id: '1', managed: false},
          {id: '2', managed: false},
        ]),
        managedPick([
          {id: '1', managed: true},
          {id: '2', managed: false},
        ]),
        managedPick([
          {id: '1', managed: false},
          {id: '2', managed: true},
          {id: '3', managed: false},
        ]),
        managedPick([
          {id: '1', managed: true},
          {id: '2', managed: true},
        ]),
      ],
      [undefined, '2', '1', '2', '2'],
    );
  });

  it('card #3010 (c3010-managed-activate): a name that matches a managed frame and a later child asks the manager for the frame, and the outcome carries the candidates with their managedness', async () => {
    async function driver(...words: string[]): Promise<string> {
      if (words[0] === 'search') {
        return '111\n222';
      }
      if (words[0] === 'windowactivate' && words.at(2) === '111') {
        return '';
      }
      await new Promise<string>(() => undefined);
      return '';
    }
    const outcome = await activateWindowWithin(
      'a window',
      driver,
      100,
      windowId => Promise.resolve(windowId === '111'),
    );
    deepStrictEqual(
      [outcome.windowId, outcome.confirmed, outcome.candidates],
      [
        '111',
        true,
        [
          {id: '111', managed: true},
          {id: '222', managed: false},
        ],
      ],
    );
  });

  it("card #3010 (c3010-managed-readout): a focus wait that never settles lists the display's windows for the name, with their managedness", async () => {
    const driver = hangingActivationDriver(words =>
      words[0] === 'search' ? '98765' : '',
    );
    const reads = focusReadsOf(driver, () => Promise.resolve('none'));
    let caught: unknown;
    try {
      await focusWindow('a window', reads, 1_000);
    } catch (error) {
      caught = error;
    }
    deepStrictEqual(
      [
        caught instanceof Error,
        caught instanceof Error &&
          caught.message.includes('98765 (no WM_STATE)'),
        caught instanceof Error && caught.message.includes('window 98765'),
        caught instanceof Error && caught.message.includes('not confirmed'),
      ],
      [true, true, true, true],
    );
  });

  it("card #3010 (c3010-pick-readout): a quick pick that never settles fails naming the display's active window", async () => {
    // A pick that never shows, beside a display whose active window has a name: the timeout names the taker, which the pages' facts cannot see.
    await rejects(
      () =>
        chooseQuickPickRow('a window', 'a row', {
          quickPick: () =>
            Promise.reject(
              new Error(
                'timed out waiting for a quick pick in window a window',
              ),
            ),
          activeWindowName: () => Promise.resolve('the taker window'),
        }),
      {message: /the display's active window "the taker window"/},
    );
  });

  it('card #3010 (c3010-toplevel-list): the display list is every visible window, with its name and whether the manager manages it', async () => {
    function driver(...words: string[]): Promise<string> {
      if (words[0] === 'search') {
        return Promise.resolve('514\n4194465');
      }
      if (words[0] === 'getwindowname' && words[1] === '514') {
        return Promise.resolve('VSCodium - Insiders');
      }
      return Promise.resolve('c2486-companion-less');
    }
    deepStrictEqual(
      await topLevelWindowsOf(driver, windowId =>
        Promise.resolve(windowId === '4194465'),
      ),
      [
        {id: '514', name: 'VSCodium - Insiders', managed: false},
        {id: '4194465', name: 'c2486-companion-less', managed: true},
      ],
    );
  });

  it('card #3010 (c3010-frame-raise): an activation the manager does not confirm raises the frame and asks it again by focus', async () => {
    const calls: string[] = [];
    const driver = hangingActivationDriver(
      words => (words[0] === 'search' ? '111' : ''),
      words => calls.push(words.join(' ')),
    );
    const outcome = await activateFrameWithin('a window', driver, 100, () =>
      Promise.resolve(true),
    );
    deepStrictEqual(
      [outcome.windowId, outcome.confirmed, calls],
      [
        '111',
        false,
        [
          'search --onlyvisible --name a window',
          'windowraise 111',
          'windowactivate --sync 111',
          'windowfocus 111',
        ],
      ],
    );
  });

  it("card #3010 (c3010-toplevel-readout): a focus wait that never settles lists the display's windows at the row's instants", async () => {
    const driver = hangingActivationDriver(() => '');
    const reads = focusReadsOf(
      driver,
      () => Promise.resolve('none'),
      () =>
        Promise.resolve([
          {
            label: 'before Help',
            windows: [{id: '514', name: 'VSCodium - Insiders', managed: true}],
          },
          {
            label: 'after Help',
            windows: [
              {id: '514', name: 'VSCodium - Insiders', managed: true},
              {id: '524', name: 'VSCodium - Insiders', managed: false},
            ],
          },
        ]),
    );
    let caught: unknown;
    try {
      await focusWindow('a window', reads, 1_000);
    } catch (error) {
      caught = error;
    }
    deepStrictEqual(
      [
        caught instanceof Error,
        caught instanceof Error &&
          caught.message.includes(
            'before Help 514 (VSCodium - Insiders, managed)',
          ),
        caught instanceof Error &&
          caught.message.includes(
            'after Help 514 (VSCodium - Insiders, managed), 524 (VSCodium - Insiders, no WM_STATE)',
          ),
      ],
      [true, true, true],
    );
  });
});
