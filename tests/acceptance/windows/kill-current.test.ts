import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  emptyWindows,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  onHost,
  openWindow,
  waitFor,
  windowEvents,
  windowState,
} from './harness.ts';

/** The process ids the pid files of the host's servers hold: the long-lived server of each kind, not its per-window children. */
async function serverProcesses(): Promise<string[]> {
  const output = await onHost(
    'sh',
    '-c',
    'for f in "$HOME"/.*/.*.pid; do [ -f "$f" ] && cat "$f" && echo; done',
  );
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^\d+$/.test(line));
}

describe('Kill Current VS Code Server in a window (card connect-43)', function () {
  this.timeout(180000);

  it('F-2411 AC-19: Kill Current in a connected default-mode window turns it into an empty local window and the server keeps running', async () => {
    await openWindow('harness', 'kc1');
    await waitFor(
      'kc1 to be connected',
      async () => (await windowState('kc1')).remoteName === 'ssh-remote',
      60_000,
    );
    const servers = await serverProcesses();
    const next = nextEmptyName();
    const name = await nextEmptyWindow(() =>
      inWindow('kc1', 'opensshremotes.cleanCurrentRemoteServer'),
    );
    await waitFor(
      'kc1 to deactivate',
      () => windowEvents('kc1').some(each => each.event === 'deactivated'),
      5000,
    );
    const failures = windowEvents('kc1').filter(
      each => each.event === 'failed',
    );
    const stillRunning = await serverProcesses();
    deepStrictEqual(
      {
        servers: servers.length > 0,
        name,
        next,
        remoteName: (await windowState(name)).remoteName,
        survivors: servers.filter(each => !stillRunning.includes(each)),
        failures,
        empty: emptyWindows().includes(name),
      },
      {
        servers: true,
        name: next,
        next,
        remoteName: null,
        survivors: [],
        failures: [],
        empty: true,
      },
    );
    await closeWindow(name);
  });
});
