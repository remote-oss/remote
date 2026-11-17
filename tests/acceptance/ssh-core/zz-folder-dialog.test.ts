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
      for (let round = 0; round < 150; round += 1) {
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
        let stalled: string[] = [];
        let retypedAfter: number | undefined;
        for (let step = 0; step < 40; step += 1) {
          const facts = await folderDialogFacts(window);
          if (facts.rows[0] === '..' && facts.value === `${HOME}/${sub}`) {
            firstDots = Date.now() - began;
            break;
          }
          await pause(100);
        }
        if (firstDots === undefined) {
          const facts = await folderDialogFacts(window);
          stalled = [
            facts.value,
            JSON.stringify(facts.rows.slice(0, 6)),
            String(facts.rows.length),
          ];
          const retyped = Date.now();
          await typeInFolderDialog(window, `${HOME}/${sub}`);
          for (let step = 0; step < 50; step += 1) {
            const again = await folderDialogFacts(window);
            if (again.rows[0] === '..' && again.value === `${HOME}/${sub}`) {
              retypedAfter = Date.now() - retyped;
              break;
            }
            await pause(100);
          }
        }
        process.stdout.write(
          `ROUND ${JSON.stringify({
            round,
            initialRows: initial.rows.slice(0, 3),
            initialCount: initial.rows.length,
            dotsAfterMs: firstDots ?? null,
            stalled,
            retypedAfterMs: retypedAfter ?? null,
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
