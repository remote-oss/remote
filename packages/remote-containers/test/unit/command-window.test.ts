import {deepStrictEqual} from 'node:assert';
import {
  admitsWindow,
  type WindowManifest,
} from '../../src/open/command-window.ts';

/** A manifest whose one command, `command`, has the palette clause `when`. */
function manifestOf(when: string | undefined): WindowManifest {
  return {
    contributes: {
      menus: {
        commandPalette: [
          {command: 'command', ...(when === undefined ? {} : {when})},
        ],
      },
    },
  };
}

/** Whether a window with each remote name is offered the command whose clause is `when`. */
function offeredBy(
  when: string,
  remoteNames: ReadonlyArray<string | undefined>,
): boolean[] {
  return remoteNames.map(name =>
    admitsWindow(manifestOf(when), 'command', name),
  );
}

const WINDOWS = [
  undefined,
  'ssh-remote',
  'tunnel',
  'wsl',
  'dev-container',
  'attached-container',
] as const;

describe('which windows a command is offered in', () => {
  it('reads a regular expression on the remote name, with the trailing question mark taking the local window in', () => {
    deepStrictEqual(
      [
        offeredBy('remoteName =~ /^(ssh-remote|tunnel)?$/', WINDOWS),
        offeredBy('remoteName =~ /^dev-container$/', WINDOWS),
      ],
      [
        [true, true, true, false, false, false],
        [false, false, false, false, true, false],
      ],
    );
  });

  it('reads the bare name, its negation, and equality and inequality with a word', () => {
    deepStrictEqual(
      [
        offeredBy('remoteName', WINDOWS),
        offeredBy('!remoteName', WINDOWS),
        offeredBy('remoteName == ssh-remote', WINDOWS),
        offeredBy('remoteName != ssh-remote', WINDOWS),
      ],
      [
        [false, true, true, true, true, true],
        [true, false, false, false, false, false],
        [false, true, false, false, false, false],
        [true, false, true, true, true, true],
      ],
    );
  });

  it('counts every term about anything else as true, whatever its form, so only the remote name decides', () => {
    deepStrictEqual(
      offeredBy(
        '!hideConnectCommands && workspaceFolderCount != 0 && workspaceFolderCount == 2 && !virtualWorkspace && !remote-containers:standingDown && remoteName =~ /^tunnel$/ && canReopen =~ /x/',
        WINDOWS,
      ),
      [false, false, true, false, false, false],
    );
  });

  it('reads parentheses, and with them and without them and binds tighter than or', () => {
    deepStrictEqual(
      [
        offeredBy('remoteName == tunnel || remoteName == wsl', WINDOWS),
        offeredBy(
          'remoteName == ssh-remote || remoteName == tunnel && remoteName == wsl',
          WINDOWS,
        ),
        offeredBy(
          '(remoteName == ssh-remote || remoteName == tunnel) && remoteName == tunnel',
          WINDOWS,
        ),
        offeredBy(
          '!(remoteName == ssh-remote || remoteName == tunnel)',
          WINDOWS,
        ),
      ],
      [
        [false, false, true, true, false, false],
        [false, true, false, false, false, false],
        [false, false, true, false, false, false],
        [true, false, false, true, true, true],
      ],
    );
  });

  it('offers a command everywhere when its clause says nothing about the remote name, and when it has no clause or no entry', () => {
    deepStrictEqual(
      [
        offeredBy('!hideConnectCommands', WINDOWS),
        WINDOWS.map(name =>
          admitsWindow(manifestOf(undefined), 'command', name),
        ),
        WINDOWS.map(name =>
          admitsWindow(manifestOf('remoteName'), 'other', name),
        ),
        WINDOWS.map(name => admitsWindow({}, 'command', name)),
      ],
      [
        [true, true, true, true, true, true],
        [true, true, true, true, true, true],
        [true, true, true, true, true, true],
        [true, true, true, true, true, true],
      ],
    );
  });
});
