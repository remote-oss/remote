import {deepStrictEqual, rejects} from 'node:assert';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  inWindow,
  nextEmptyWindow,
  onHost,
  recordLines,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  notifications,
  rowAction,
  titleAction,
  viewRows,
} from '../windows/renderer.ts';

/** The view's name (F-5101 3.3). */
const VIEW = 'Remotes (Tunnels/SSH)';
/** The row and title actions, as the manifest gives them (F-5002 3.1). */
const NEW = 'Connect in New Window...';
const CURRENT = 'Connect in Current Window...';
const REFRESH = 'Refresh';
/** The stand-down warning, as the product gives it (F-5001 3.4, athena's ruling on #636: it names no Microsoft id). */
const STAND_DOWN_WARNING =
  'Remote Explorer stays inactive in this window because another Remote Explorer extension is enabled. Both use the same commands, settings and views. Disable one of the two and reload the window.';

/** The hosts of the run's ssh_config in file order: the words after a `Host` line that are not patterns. */
function hosts(): string[] {
  return readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8')
    .split('\n')
    .flatMap(line => {
      const words = line.trim().split(/\s+/);
      return words[0]?.toLowerCase() === 'host'
        ? words.slice(1).filter(word => !/[?*!]/.test(word))
        : [];
    });
}

/** Shows the view in `name`, then reads its rows, polling every 200 ms for up to 15 s until `holds` is true. */
async function settledRows(
  name: string,
  holds: (rows: NonNullable<ReturnType<typeof viewRows>>) => boolean,
): Promise<NonNullable<ReturnType<typeof viewRows>>> {
  await inWindow(name, 'remoteTargets.focus');
  let rows: NonNullable<ReturnType<typeof viewRows>> = [];
  await waitFor(`the rows of ${VIEW} in ${name} to settle`, async () => {
    try {
      rows = (await viewRows(name, VIEW)) ?? [];
    } catch {
      rows = [];
    }
    return holds(rows);
  }, 15_000);
  return rows;
}

/** Nothing in `name` has failed: no error-shaped notification, no notice line from it. */
async function nothingFails(name: string): Promise<void> {
  const bad = (await notifications(name)).filter(text =>
    /(Error|error|not found|failed)/.test(text),
  );
  const notices = recordLines('notice', name);
  deepStrictEqual(
    {bad, notices: notices.length},
    {bad: [], notices: 0},
    `window ${name} failed: notifications ${JSON.stringify(bad)}, notices ${JSON.stringify(notices)}`,
  );
}

describe('the gate rows of explorer slice 1 (card coverage-25b, part of #645)', function () {
  this.timeout(300_000);

  it('F-5101 (the SSH group), F-5102 (host list, order): the Remotes view shows the SSH group with the run hosts in order', async () => {
    const list = hosts();
    const rows = await settledRows('local', each =>
      each.length >= 1 + list.length,
    );
    deepStrictEqual(
      {
        first: rows[0]?.label,
        firstLevel: rows[0]?.level,
        firstExpanded: rows[0]?.expanded,
        hosts: rows.slice(1).map(row => [row.label, row.level, row.description]),
      },
      {
        first: 'SSH',
        firstLevel: 1,
        firstExpanded: true,
        hosts: list.map(name => [name, 2, ''] as [string, number, string]),
      },
    );
    await nothingFails('local');
  });

  it('F-5103 (connect in a new window): Connect in New Window on harness opens empty-1 on ssh-remote+harness and leaves the picking window', async () => {
    const name = await nextEmptyWindow(() =>
      rowAction('local', VIEW, 'harness', NEW),
    );
    deepStrictEqual(name, 'empty-1');
    deepStrictEqual((await windowState(name)).remoteName, 'ssh-remote');
    await inWindow(name, 'acceptance.agent.writeFile', 'gate-probe', 'x');
    deepStrictEqual(await onHost('cat', '/home/harness/gate-probe'), 'x\n');
    deepStrictEqual((await windowState('local')).remoteName, null);
    await nothingFails('local');
    await closeWindow(name);
  });

  it('F-5103 (connect in the current window): Connect in Current Window turns local into empty-2 on ssh-remote+harness', async () => {
    const name = await nextEmptyWindow(() =>
      rowAction('local', VIEW, 'harness', CURRENT),
    );
    deepStrictEqual(name, 'empty-2');
    deepStrictEqual((await windowState(name)).remoteName, 'ssh-remote');
    await inWindow(name, 'acceptance.agent.writeFile', 'gate-probe', 'x');
    deepStrictEqual(await onHost('cat', '/home/harness/gate-probe'), 'x\n');
    await nothingFails('local');
  });

  it('F-5103 BR-6 (the marker), F-5902 (the pull decides): in empty-2 the harness row is marked connected, the others are not', async () => {
    const list = hosts();
    const rows = await settledRows('empty-2', each =>
      each.some(row => row.label === 'harness'),
    );
    const marked = rows.filter(row => row.description === 'connected');
    deepStrictEqual(
      {
        harness: rows.find(row => row.label === 'harness')?.description,
        marked,
      },
      {
        harness: 'connected',
        marked: ['harness'],
      },
    );
    for (const row of rows) {
      if (row.label !== 'harness' && row.level === 2) {
        deepStrictEqual(row.description, '', `row ${row.label} unexpectedly marked`);
      }
    }
    void list;
    await nothingFails('empty-2');
  });

  it('F-5101 (Refresh), F-5102 (host list): a Host added to the file appears after Refresh, then goes when it is restored', async () => {
    const config = variable('HARNESS_SSH_CONFIG');
    const original = readFileSync(config, 'utf8');
    let added = false;
    try {
      writeFileSync(config, `${original}\nHost gate-added\n\tHostName 127.0.0.1\n`);
      added = true;
      await titleAction('empty-2', VIEW, REFRESH);
      const list = hosts();
      const rows = await settledRows('empty-2', each =>
        each.some(row => row.label === 'gate-added'),
      );
      const hostLabels = rows
        .filter(row => row.level === 2)
        .map(row => row.label);
      deepStrictEqual(
        {hosts: hostLabels, harness: rows.find(row => row.label === 'harness')?.description},
        {hosts: [...list, 'gate-added'], harness: 'connected'},
      );
      await nothingFails('empty-2');
    } finally {
      if (added) {
        writeFileSync(config, original);
      }
    }
    await titleAction('empty-2', VIEW, REFRESH);
    const rows = await settledRows('empty-2', each =>
      !each.some(row => row.label === 'gate-added'),
    );
    deepStrictEqual(
      rows.filter(row => row.level === 2).map(row => row.label),
      hosts(),
    );
  });

  it('F-5001 (stand-down), F-5901 (coexistence): with the reference id present the explorer stands down, shows no SSH row and its refresh is not registered', async () => {
    const run = variable('HARNESS_RUN_FOLDER');
    const standIn = path.join(run, 'extensions-explorer', 'ms-vscode.remote-explorer');
    mkdirSync(standIn, {recursive: true});
    writeFileSync(
      path.join(standIn, 'package.json'),
      JSON.stringify(
        {
          publisher: 'ms-vscode',
          name: 'remote-explorer',
          displayName: 'Acceptance stand-in (not the reference)',
          version: '0.0.0',
          engines: {vscode: '*'},
        },
        null,
        2,
      ),
    );
    try {
      const name = await openFolderWindow(
        path.join(run, 'gate-standdown'),
      );
      const refresh = inWindow(name, 'remote-explorer.refresh');
      const warned = (await notifications(name)).some(
        text => text.includes(STAND_DOWN_WARNING),
      );
      const rows = await (async () => {
        await inWindow(name, 'remoteTargets.focus');
        return (await viewRows(name, VIEW)) ?? [];
      })();
      deepStrictEqual(warned, true, `no stand-down warning among ${JSON.stringify(await notifications(name))}`);
      deepStrictEqual(
        rows.some(row => row.label === 'SSH'),
        false,
        `the stood-down view lists no SSH row: ${JSON.stringify(rows)}`,
      );
      await rejects(refresh, /not found|No command|not.*registered/i);
    } finally {
      rmSync(standIn, {recursive: true, force: true});
    }
  });
});
