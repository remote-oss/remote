/**
 * @fileoverview The rows of the SSH configuration file picker (card ssh-11, amended to string ids): the
 * configured file as written, or the user and system files, with the settings and help rows by their ids;
 * narrowing keeps a file row while its path contains the typed text, and the fixed rows always.
 */

import {deepStrictEqual} from 'node:assert';
import {
  buildFileChoice,
  narrowFileChoice,
  type FileChoiceItem,
} from '../../src/config/file-choice.ts';

/** The user file row of the default picker. */
const USER_FILE: FileChoiceItem = {
  kind: 'file',
  label: '/home/u/.ssh/config',
  role: 'user',
};

/** The system file row of the default picker. */
const SYSTEM_FILE: FileChoiceItem = {
  kind: 'file',
  label: '/etc/ssh/ssh_config',
  role: 'system',
};

/** The settings row, by the ids of the contract. */
const SETTINGS_ROW: FileChoiceItem = {
  kind: 'settings',
  label: {id: 'S131', values: []},
  description: {id: 'S166', values: []},
};

/** The help row, by the ids of the contract. */
const HELP_ROW: FileChoiceItem = {
  kind: 'help',
  label: {id: 'S077', values: []},
  description: {id: 'S162', values: []},
};

/** The four rows of the default picker, in order. */
function defaultItems(): readonly FileChoiceItem[] {
  return [USER_FILE, SYSTEM_FILE, SETTINGS_ROW, HELP_ROW];
}

describe('buildFileChoice (the rows of the configuration file picker)', () => {
  it('F-2203.AC-2: no configured file, the select placeholder and the four rows', () => {
    deepStrictEqual(
      buildFileChoice({
        configFile: '',
        userFile: '/home/u/.ssh/config',
        systemFile: '/etc/ssh/ssh_config',
      }),
      {
        placeholder: {id: 'S126', values: []},
        items: [USER_FILE, SYSTEM_FILE, SETTINGS_ROW, HELP_ROW],
      },
    );
  });

  it('F-2203.BR-1: a whitespace-only configured file is the same as unset', () => {
    deepStrictEqual(
      buildFileChoice({
        configFile: '   ',
        userFile: '/home/u/.ssh/config',
        systemFile: '/etc/ssh/ssh_config',
      }),
      buildFileChoice({
        configFile: '',
        userFile: '/home/u/.ssh/config',
        systemFile: '/etc/ssh/ssh_config',
      }),
    );
  });

  it('F-2203.BR-2: the user row is the user file exactly', () => {
    deepStrictEqual(defaultItems()[0], USER_FILE);
  });

  it('F-2203.BR-3: the last two rows are the settings and help rows, by their ids', () => {
    deepStrictEqual(
      buildFileChoice({
        configFile: '~/ssh/mine',
        userFile: '/home/u/.ssh/config',
        systemFile: '/etc/ssh/ssh_config',
      }).items.slice(-2),
      [SETTINGS_ROW, HELP_ROW],
    );
  });

  it('F-2203.AC-11: a home-relative file is the edit placeholder and its row alone', () => {
    deepStrictEqual(
      buildFileChoice({
        configFile: '~/ssh/mine',
        userFile: '/home/u/.ssh/config',
        systemFile: '/etc/ssh/ssh_config',
      }),
      {
        placeholder: {id: 'S047', values: []},
        items: [
          {kind: 'file', label: '~/ssh/mine', role: 'configured'},
          SETTINGS_ROW,
          HELP_ROW,
        ],
      },
    );
  });

  it('F-2203.AC-11: a relative file is not normalised and no other file row appears', () => {
    deepStrictEqual(
      buildFileChoice({
        configFile: 'relative/cfg',
        userFile: '/home/u/.ssh/config',
        systemFile: '/etc/ssh/ssh_config',
      }),
      {
        placeholder: {id: 'S047', values: []},
        items: [
          {kind: 'file', label: 'relative/cfg', role: 'configured'},
          SETTINGS_ROW,
          HELP_ROW,
        ],
      },
    );
  });

  it('F-2204.AC-32: the add flow builds the same rows for a system file', () => {
    deepStrictEqual(
      buildFileChoice({
        configFile: '/etc/x/config',
        userFile: '/home/u/.ssh/config',
        systemFile: '/etc/ssh/ssh_config',
      }),
      {
        placeholder: {id: 'S047', values: []},
        items: [
          {kind: 'file', label: '/etc/x/config', role: 'configured'},
          SETTINGS_ROW,
          HELP_ROW,
        ],
      },
    );
  });
});

describe('narrowFileChoice (the typed text of the picker)', () => {
  it('F-2203.AC-2: no typed text, the rows are unchanged', () => {
    deepStrictEqual(narrowFileChoice(defaultItems(), ''), defaultItems());
  });

  it('F-2203.AC-29: a word in no path keeps the fixed rows, and only them', () => {
    deepStrictEqual(narrowFileChoice(defaultItems(), 'zzz'), [
      SETTINGS_ROW,
      HELP_ROW,
    ]);
  });

  it('F-2203.AC-29: a word in the system file keeps that file before the fixed rows', () => {
    deepStrictEqual(narrowFileChoice(defaultItems(), 'ssh_config'), [
      SYSTEM_FILE,
      SETTINGS_ROW,
      HELP_ROW,
    ]);
  });

  it('F-2203.AC-29: a folder of the system file keeps that file before the fixed rows', () => {
    deepStrictEqual(narrowFileChoice(defaultItems(), '/etc'), [
      SYSTEM_FILE,
      SETTINGS_ROW,
      HELP_ROW,
    ]);
  });

  it('F-2203.AC-29: a word in no file path leaves the fixed rows in place', () => {
    deepStrictEqual(narrowFileChoice(defaultItems(), 'elp'), [
      SETTINGS_ROW,
      HELP_ROW,
    ]);
  });

  it('F-2203.AC-29: the matching ignores the case of the typed text', () => {
    deepStrictEqual(narrowFileChoice(defaultItems(), 'SSH_CONFIG'), [
      SYSTEM_FILE,
      SETTINGS_ROW,
      HELP_ROW,
    ]);
  });
});
