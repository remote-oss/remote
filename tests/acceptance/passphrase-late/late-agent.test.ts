import {deepStrictEqual} from 'node:assert';
import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  fingerprintOf,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {answerInputBox} from '../windows/renderer.ts';
import {
  openKeyWindow,
  passphrase,
  untilConnected,
  untilPassphraseInput,
} from '../windows/key-windows.ts';

describe('an agent started after the editor (card coverage-96)', function () {
  this.timeout(300_000);

  it('F-2307 AC-29 (c96-late-agent): with SSH_AUTH_SOCK naming a socket where no agent ran at the start, an agent started on it later receives the key of a connect with AddKeysToAgent yes', async () => {
    const folder = variable('HARNESS_RUN_FOLDER');
    const socket = path.join(folder, 'late-agent.sock');
    const agent = spawn('ssh-agent', ['-D', '-a', socket], {stdio: 'ignore'});
    try {
      await waitFor('the agent socket', () => existsSync(socket), 30_000);
      const name = await openKeyWindow('passkey-add-yes', 'c96-late-agent');
      try {
        await untilPassphraseInput(name);
        await answerInputBox(name, passphrase());
        await untilConnected(name, 'passkey-add-yes');
        const listed = execFileSync('ssh-add', ['-l'], {
          env: {...process.env, SSH_AUTH_SOCK: socket},
          encoding: 'utf8',
        });
        deepStrictEqual(
          listed.includes(
            await fingerprintOf(path.join(folder, 'id_passphrase')),
          ),
          true,
        );
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    } finally {
      agent.kill();
    }
  });
});
