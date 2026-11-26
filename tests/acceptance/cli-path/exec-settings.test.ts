/**
 * @fileoverview The exec-server mode on the CLI-source editor, by the values of `remote.SSH.useExecServer` and the
 * local server (F-2103, card #3028): a connect that takes exec mode leaves the editor's CLI, the server it installed
 * below `cli/servers` and one running CLI on a fresh host, and shows no message of the extension's own.
 */

import {keepingSettings} from '../windows/tunnel-support.ts';
import {
  EXEC_FACTS,
  execConnect,
  sameOrTell,
  type ExecFacts,
  type Messages,
} from './exec-layout.ts';

/** No message of the extension's own: no dialog and no notification. */
const NO_MESSAGES: Messages = {dialog: undefined, notifications: []};

/** What an exec-mode connect leaves, whatever the legacy folder holds (F-2103 AC-2 asks the folder's absence of its own row). */
function execLayout(facts: ExecFacts) {
  return {
    launcher: facts.launcher,
    server: facts.server,
    cliProcesses: facts.cliProcesses,
  };
}

describe('the exec-server mode on the CLI-source editor (card #3028, F-2103)', function () {
  this.timeout(600_000);

  it.skip('F-2103 AC-2 (c3028-unset): waits for #3082 (an exec-mode connect makes an empty bin/<commit>): with the setting unset on a fresh host the editor’s CLI file, its server below cli/servers and one CLI process stand, and there is no bin/<commit>', async () => {
    await keepingSettings(async () => {
      const {facts, messages, told} = await execConnect(
        'c3028-unset',
        'c3028-unset',
        {},
      );
      await sameOrTell(
        [facts, messages],
        [{...EXEC_FACTS, binFolder: false}, NO_MESSAGES],
        told,
      );
    });
  });

  it('F-2103 AC-5 (c3028-true): with the setting set to true on a fresh host the result is the same as with it unset: the CLI file, its server and one CLI process', async () => {
    await keepingSettings(async () => {
      const {facts, messages, told} = await execConnect(
        'c3028-true',
        'c3028-true',
        {'remote.SSH.useExecServer': true},
      );
      await sameOrTell(
        [execLayout(facts), messages],
        [EXEC_FACTS, NO_MESSAGES],
        told,
      );
    });
  });

  it.skip('F-2103 AC-18, AC-30 (c3028-strings): waits for #3180 (the effective setting reads a string by identity, not by its truthiness, so "no" and "false" give the legacy install): the strings "no" and "false" give exec mode and the extension shows no message', async () => {
    const outcomes: unknown[] = [];
    const lines: string[] = [];
    for (const value of ['no', 'false']) {
      await keepingSettings(async () => {
        const {facts, messages, told} = await execConnect(
          `c3028-string-${value}`,
          `c3028-string-${value}`,
          {'remote.SSH.useExecServer': value},
        );
        outcomes.push([value, execLayout(facts), messages]);
        lines.push(`${value}: ${told}`);
      });
    }
    await sameOrTell(
      outcomes,
      [
        ['no', EXEC_FACTS, NO_MESSAGES],
        ['false', EXEC_FACTS, NO_MESSAGES],
      ],
      lines.join('\n'),
    );
  });

  it('F-2103 AC-34 (c3028-lower-case): only the lower-case key "remote.ssh.useExecServer": false in the user settings gives exec mode, as with the setting unset', async () => {
    await keepingSettings(async () => {
      const {facts, messages, told} = await execConnect(
        'c3028-lower-case',
        'c3028-lower-case',
        {'remote.ssh.useExecServer': false},
      );
      await sameOrTell(
        [execLayout(facts), messages],
        [EXEC_FACTS, NO_MESSAGES],
        told,
      );
    });
  });

  it('F-2103 AC-19, AC-26 (c3028-no-local-server): with remote.SSH.useLocalServer false each connect succeeds: in exec mode the CLI runs on the host, in legacy mode no CLI runs and the install is in bin/<commit>', async () => {
    const exec = await keepingSettings(() =>
      execConnect('c3028-no-local-exec', 'c3028-no-local-exec', {
        'remote.SSH.useLocalServer': false,
      }),
    );
    const legacy = await keepingSettings(() =>
      execConnect('c3028-no-local-legacy', 'c3028-no-local-legacy', {
        'remote.SSH.useLocalServer': false,
        'remote.SSH.useExecServer': false,
      }),
    );
    await sameOrTell(
      [
        execLayout(exec.facts),
        execLayout(legacy.facts),
        legacy.facts.binFolder,
      ],
      [EXEC_FACTS, {launcher: false, server: false, cliProcesses: 0}, true],
      `${exec.told}\n${legacy.told}`,
    );
  });
});
