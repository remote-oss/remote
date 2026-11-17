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
      for (let round = 0; round < 40; round += 1) {
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
        const readings: string[] = [];
        let firstDots: number | undefined;
        for (let step = 0; step < 100; step += 1) {
          const facts = await folderDialogFacts(window);
          const head = facts.rows.slice(0, 3);
          if (step % 5 === 0 || (head[0] === '..' && firstDots === undefined)) {
            readings.push(
              `${String(Date.now() - began)}ms ${JSON.stringify([facts.value, head, facts.rows.length])}`,
            );
          }
          if (head[0] === '..' && firstDots === undefined) {
            firstDots = Date.now() - began;
          }
          if (firstDots !== undefined && step > 5) {
            break;
          }
          await pause(100);
        }
        process.stdout.write(
          `ROUND ${JSON.stringify({
            round,
            initialRows: initial.rows.slice(0, 3),
            initialCount: initial.rows.length,
            dotsAfterMs: firstDots ?? null,
            readings: firstDots === undefined ? readings : readings.slice(-2),
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
