import {
  closeWindow,
  editorCommandLine,
  inWindow,
  isOpen,
  onHostAs,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {
  pressEscape,
  quickPickRows,
  statusBarText,
  typeInQuickPick,
  waitForQuickPick,
} from '../windows/renderer.ts';

const HOME = '/home/harness';

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('what the Open Recent pick shows after many folders were opened (card #2756, throwaway)', function () {
  this.timeout(2_400_000);

  beforeEach(closeAllButLocal);

  it('the rounds', async () => {
    for (const count of [5, 15, 30]) {
      const folders = Array.from(
        {length: count},
        (_, index) => `zz-r-${String(count)}-${String(index)}`,
      );
      await onHostAs(
        'harness',
        'mkdir',
        '-p',
        `${HOME}/zz-r.dot-${String(count)}`,
        ...folders.map(each => `${HOME}/${each}`),
      );
      for (const folder of folders) {
        await editorCommandLine(
          '--folder-uri',
          `vscode-remote://ssh-remote+harness${HOME}/${folder}`,
        );
        await waitFor(
          `${folder} to show SSH: harness`,
          async () =>
            isOpen(folder) &&
            (await statusBarText(folder, 'status.host').catch(() => '')) ===
              'SSH: harness',
          120_000,
        );
        await closeWindow(folder).catch(() => undefined);
      }
      await editorCommandLine(
        '--remote',
        'ssh-remote+harness',
        `${HOME}/zz-r.dot-${String(count)}`,
      );
      await pause(10_000);
      void inWindow('local', 'workbench.action.openRecent');
      await waitForQuickPick('local', 30_000);
      const rows = await quickPickRows('local');
      const target = `zz-r.dot-${String(count)}`;
      const found = rows.some(each => each.label.startsWith(target));
      await typeInQuickPick('local', target);
      await pause(1500);
      const filtered = await quickPickRows('local');
      await pressEscape('local');
      process.stdout.write(
        `RECENT ${JSON.stringify({
          count,
          renderedRows: rows.length,
          foundWithoutFilter: found,
          filteredRows: filtered.map(
            each => `${each.label} | ${each.description}`,
          ),
          firstRows: rows.slice(0, 3).map(each => each.label),
        })}\n`,
      );
    }
  });
});
