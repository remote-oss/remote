import {execFile} from 'node:child_process';
import {chmodSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  appendScript,
  closeWindow,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {dismissals} from '../windows/maintenance.ts';

const execFileAsync = promisify(execFile);

/** The lines of the run's `Host harness` block, without its `Host` line. */
function harnessLines(): string[] {
  const lines = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8').split(
    '\n',
  );
  const start = lines.indexOf('Host harness');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => !line.startsWith(' '));
  return rest.slice(0, end === -1 ? rest.length : end);
}

/** The ssh processes of this user, as a table. */
async function sshTree(): Promise<string> {
  const {stdout} = await execFileAsync('ps', [
    '-u',
    String(process.getuid?.() ?? 0),
    '-o',
    'pid,ppid,pgid,sid,etimes,args',
  ]);
  return stdout
    .split('\n')
    .filter(line => /ssh/.test(line) && !/ps -u|sshd|jump-probe/.test(line))
    .map(line => line.slice(0, 200))
    .join('\n');
}

describe('probe: the processes of a ProxyJump recursion (card #2664)', function () {
  this.timeout(600_000);

  it('probe: the process tree at the dialog and after it', async () => {
    const found: string[] = [];
    for (const mode of ['server', 'terminal'] as const) {
      const alias = `c2664-${mode}`;
      const jump = `jump2664-${mode}`;
      const run = variable('HARNESS_RUN_FOLDER');
      const wrapper = path.join(run, `ssh-capped-${mode}.sh`);
      writeFileSync(
        wrapper,
        '#!/bin/sh\nulimit -u $(( $(ps -u $(id -u) -o pid= | wc -l) + 40 ))\nexec ssh "$@"\n',
      );
      chmodSync(wrapper, 0o755);
      const file = path.join(run, `${alias}.config`);
      writeFileSync(
        file,
        [
          `Host ${alias}`,
          ...harnessLines(),
          '',
          `Host ${jump}`,
          ...harnessLines(),
          '',
          'Host *',
          `  ProxyJump ${jump}`,
          '',
        ].join('\n'),
      );
      const saved = readUserSettings();
      await userSettings({
        'remote.SSH.configFile': file,
        'remote.SSH.path': wrapper,
        ...(mode === 'terminal' ? {'remote.SSH.useLocalServer': false} : {}),
      });
      const mark = Date.now();
      appendScript(dismissals(alias));
      try {
        await openWindow(alias, alias);
        await waitFor(
          'the failure dialog',
          () =>
            recordLines('failureDialog', alias).some(line => line.time >= mark),
          180_000,
        ).catch(() => undefined);
        const dialog = recordLines('failureDialog', alias).find(
          line => line.time >= mark,
        );
        found.push(
          `== ${mode}: dialog after ${dialog === undefined ? 'no dialog' : String(dialog.time - mark)} ms: ${JSON.stringify(dialog?.question)}`,
          `-- ssh processes at the dialog:`,
          await sshTree(),
        );
        await new Promise(resolve => setTimeout(resolve, 5000));
        found.push('-- 5 s later:', await sshTree());
        await closeWindow(alias).catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 3000));
        found.push('-- after the window closed:', await sshTree());
      } finally {
        restoreUserSettings(saved);
      }
    }
    throw new Error(`PROBE RESULT\n${found.join('\n')}`);
  });
});
