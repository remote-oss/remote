import {
  closeWindow,
  connectedWithin,
  inWindow,
  onHostAs,
  openWindow,
  waitFor,
} from '../windows/harness.ts';
import {
  cancelFolderDialog,
  folderDialogFacts,
  folderDialogOpen,
  typeInFolderDialog,
} from '../windows/renderer.ts';

const HOME = '/home/harness';

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('what the folder dialog does with a typed folder (card #2756, throwaway)', function () {
  this.timeout(2_400_000);

  it('the rounds', async () => {
    const window = 'zz-folder-dialog';
    await onHostAs('harness', 'mkdir', '-p', `${HOME}/${window}`);
    await openWindow('harness', window);
    await connectedWithin(window, 120_000);
    try {
      for (let round = 0; round < 400; round += 1) {
        const sub = `zz-fd-sub-${String(round)}`;
        await onHostAs('harness', 'mkdir', '-p', `${HOME}/${sub}`);
        void inWindow(window, 'workbench.action.files.openFolder');
        await waitFor('the dialog', () => folderDialogOpen(window), 30_000);
        await waitFor(
          'the home entries',
          async () => (await folderDialogFacts(window)).rows.includes('.ssh'),
          30_000,
        );
        const initial = await folderDialogFacts(window);
        const began = Date.now();
        await typeInFolderDialog(window, `${HOME}/${sub}`);
        let firstDots: number | undefined;
        for (let step = 0; step < 40; step += 1) {
          const facts = await folderDialogFacts(window);
          if (facts.rows[0] === '..' && facts.value === `${HOME}/${sub}`) {
            firstDots = Date.now() - began;
            break;
          }
          await pause(100);
        }
        let recovery: Record<string, unknown> = {};
        if (firstDots === undefined) {
          const facts = await folderDialogFacts(window);
          const target = `${HOME}/${sub}`;
          const tried: Record<string, unknown> = {
            value: facts.value,
            rows: facts.rows,
            onHost: (
              await onHostAs(
                'harness',
                'sh',
                '-c',
                `ls -d '${target}' 2>&1; true`,
              )
            ).trim(),
          };
          async function dotsWithin(
            milliseconds: number,
          ): Promise<number | null> {
            const started = Date.now();
            while (Date.now() - started < milliseconds) {
              const again = await folderDialogFacts(window);
              if (again.rows[0] === '..') {
                return Date.now() - started;
              }
              await pause(100);
            }
            return null;
          }
          await typeInFolderDialog(window, `${target}/`);
          tried.trailingSlashDotsAfterMs = await dotsWithin(3000);
          if (tried.trailingSlashDotsAfterMs === null) {
            await typeInFolderDialog(window, `${HOME}/`);
            await pause(1500);
            await typeInFolderDialog(window, target);
            tried.clearedAndRetypedDotsAfterMs = await dotsWithin(3000);
          }
          recovery = tried;
        }
        process.stdout.write(
          `ROUND ${JSON.stringify({
            round,
            initialRows: initial.rows.slice(0, 3),
            initialCount: initial.rows.length,
            dotsAfterMs: firstDots ?? null,
            recovery,
          })}\n`,
        );
        await cancelFolderDialog(window).catch(() => undefined);
        await pause(500);
      }
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
