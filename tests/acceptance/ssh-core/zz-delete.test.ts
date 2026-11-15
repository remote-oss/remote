import {
  closeWindow,
  editorProduct,
  onHost,
  openWindow,
  settingIn,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';

const KEY = 'terminal.integrated.defaultProfile.linux';

describe('the window reads a removed machine settings file (card #2641, throwaway measurement)', function () {
  this.timeout(900_000);

  beforeEach(closeAllButLocal);

  it('eight writes of zsh, each removal timed, and an empty write after a missed removal, each timed until the window reads it', async () => {
    const file = `/home/harness/${editorProduct().serverDataFolderName}/data/Machine/settings.json`;
    await onHost('sh', '-c', `mkdir -p "$(dirname '${file}')"`);
    await onHost('rm', '-f', file);
    await openWindow('harness', 'c2641-del');
    const rounds: unknown[] = [];
    try {
      for (let round = 0; round < 8; round += 1) {
        await onHost('sh', '-c', `printf '%s' '{"${KEY}": "zsh"}' > '${file}'`);
        const wrote = Date.now();
        const appeared = await waitFor(
          'zsh to be read',
          async () => (await settingIn('c2641-del', KEY)) === 'zsh',
          30_000,
        ).then(
          () => Date.now() - wrote,
          () => 'not within 30 s',
        );
        await onHost('rm', '-f', file);
        const removed = Date.now();
        const vanished = await waitFor(
          'zsh to be gone after the removal',
          async () => (await settingIn('c2641-del', KEY)) !== 'zsh',
          20_000,
        ).then(
          () => Date.now() - removed,
          () => 'not within 20 s',
        );
        let emptied: number | string = 'not needed';
        if (typeof vanished === 'string') {
          await onHost('sh', '-c', `printf '%s' '{}' > '${file}'`);
          const emptiedAt = Date.now();
          emptied = await waitFor(
            'zsh to be gone after an empty write',
            async () => (await settingIn('c2641-del', KEY)) !== 'zsh',
            30_000,
          ).then(
            () => Date.now() - emptiedAt,
            () => 'not within 30 s',
          );
          await onHost('rm', '-f', file);
        }
        rounds.push({round, appeared, vanished, emptied});
      }
    } finally {
      await onHost('rm', '-f', file);
      await closeWindow('c2641-del').catch(() => undefined);
      process.stdout.write(`DEL ${JSON.stringify(rounds)}\n`);
    }
  });
});
