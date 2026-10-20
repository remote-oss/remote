import {deepStrictEqual} from 'node:assert';
import type {LastResolve} from 'lib-authority';
import {
  type ActiveFoldersPush,
  createProtocol,
  EXPLORER_INBOX,
  type Timers,
  writeActiveFoldersPush,
  writeEnvelope,
} from 'lib-companion';
import {createRecordingFake} from 'lib-companion/testing/recording-fake';
import {pushActiveFolders} from '../../src/companion/active-folders.ts';
import {signalHostsChanged} from '../../src/companion/hosts-changed.ts';

const NO_TIMERS: Timers = {
  setTimer: () => undefined,
  clearTimer: () => undefined,
};

/** A window: what it has, how its first resolve ended, and the pushes sent. */
function windowOf(options: {
  workspace?: boolean;
  authority?: string;
  lastResolve?: LastResolve;
  firings?: number;
  sendFails?: boolean;
}) {
  const sent: ActiveFoldersPush[] = [];
  const listeners: Array<() => void> = [];
  pushActiveFolders({
    hasWorkspace: () => options.workspace ?? true,
    remoteAuthority: () => options.authority,
    resolve: {
      onFirstResolveSettled: listener => {
        listeners.push(listener);
      },
      lastResolve: () => options.lastResolve ?? 'succeeded',
    },
    send: push => {
      sent.push(push);
      if (options.sendFails === true) {
        throw new Error('the command is not registered');
      }
    },
  });
  function settle(): void {
    for (let count = 0; count < (options.firings ?? 1); count += 1) {
      for (const listener of listeners) {
        listener();
      }
    }
  }
  return {sent, settle, listenerCount: listeners.length};
}

describe('the active-folders push (card ssh-provider-03)', () => {
  it('F-3906 rule 7, F-2503 BR-14: an ssh-remote window pushes connected with its host key when the first resolve settles, and no folders', () => {
    const scene = windowOf({authority: 'ssh-remote+host-a'});
    const before = [...scene.sent];
    scene.settle();
    deepStrictEqual(
      [before, scene.sent, 'folders' in (scene.sent[0] ?? {})],
      [
        [],
        [writeActiveFoldersPush({outcome: 'connected', hostKey: 'host-a'})],
        false,
      ],
    );
  });

  it('F-3906 rule 7: a first resolve that failed pushes failed with the host key', () => {
    const scene = windowOf({
      authority: 'ssh-remote+host-a',
      lastResolve: 'failed',
    });
    scene.settle();
    deepStrictEqual(scene.sent, [
      writeActiveFoldersPush({outcome: 'failed', hostKey: 'host-a'}),
    ]);
  });

  it('ruling 3: a local window and a container window push none, at the call, with no host key', () => {
    deepStrictEqual(
      [windowOf({}).sent, windowOf({authority: 'dev-container+abc'}).sent].map(
        pushes => pushes.map(push => [push.outcome, 'hostKey' in push]),
      ),
      [[['none', false]], [['none', false]]],
    );
  });

  it('F-5902 AC-31: a window with no folder or workspace pushes nothing, not even after the resolve settles', () => {
    const scene = windowOf({workspace: false, authority: 'ssh-remote+host-a'});
    scene.settle();
    deepStrictEqual(
      [scene.sent, scene.listenerCount, windowOf({workspace: false}).sent],
      [[], 0, []],
    );
  });

  it('rejection: a send that throws is dropped, with no throw out of the push, at the call or when the resolve settles', () => {
    const local = windowOf({sendFails: true});
    const remote = windowOf({authority: 'ssh-remote+host-a', sendFails: true});
    remote.settle();
    deepStrictEqual([local.sent.length, remote.sent.length], [1, 1]);
  });

  it('F-3906 rule 7: a listener that fires twice pushes once', () => {
    const scene = windowOf({authority: 'ssh-remote+host-a', firings: 2});
    scene.settle();
    deepStrictEqual(scene.sent.length, 1);
  });
});

describe('the hosts-changed signal (card ssh-provider-03)', () => {
  function protocolOver(failure?: Error) {
    const fake = createRecordingFake();
    const executed: unknown[][] = [];
    const recordingBus = {
      ...fake,
      executeCommand: (commandId: string, ...given: unknown[]) => {
        executed.push([commandId, ...given]);
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        return Promise.resolve(undefined);
      },
    };
    return {
      executed,
      protocol: createProtocol({
        // eslint-disable-next-line id-length -- the protocol's option is named bus
        bus: recordingBus,
        timers: NO_TIMERS,
        onVersionMismatch: () => undefined,
      }),
    };
  }

  it('brief §3.4: the signal is the envelope sent to the inbox command, once per call', () => {
    const {protocol, executed} = protocolOver();
    signalHostsChanged(protocol);
    signalHostsChanged(protocol);
    deepStrictEqual(executed, [
      [EXPLORER_INBOX.sshHostsChanged.commandId, writeEnvelope()],
      [EXPLORER_INBOX.sshHostsChanged.commandId, writeEnvelope()],
    ]);
  });

  it('brief §3.4: a signal the editor refuses is dropped with no throw', async () => {
    const {protocol, executed} = protocolOver(new Error('command not found'));
    signalHostsChanged(protocol);
    await Promise.resolve();
    deepStrictEqual(executed.length, 1);
  });
});
