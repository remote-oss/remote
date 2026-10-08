/**
 * @fileoverview The parts of an SSH host channel every test shares.
 */

import type {SshHostChannelOptions} from '../../src/index.ts';
import {ScriptedSpawner} from './fake-client-process.ts';

/** A channel's options with a spawner that never starts anything useful, for tests to override. */
export function channelBase(): SshHostChannelOptions {
  return {
    hostString: 'user@host.invalid:22',
    platform: 'linux',
    base: {
      target: {host: 'host.invalid', user: 'user'},
      settings: {
        configFile: '',
        connectTimeout: 15,
        permitPtyAllocation: false,
        remoteCommandInEffect: false,
      },
      effective: {
        hostName: 'host.invalid',
        user: 'user',
        port: '22',
        localForwards: [],
      },
      programs: {sshProgram: '/usr/bin/ssh', scpProgram: '/usr/bin/scp'},
      homeFolder: '/home/user',
      platform: 'linux',
    },
    spawner: new ScriptedSpawner(() => undefined).spawn,
    editorEnvironment: {PATH: '/usr/bin'},
    askpassEnvironment: {},
    files: {
      exists: () => Promise.resolve(false),
      read: () => asyncPieces([]),
    },
    scheduler: {setTimer: () => () => undefined},
  };
}

/** Pieces of a file as a stream delivers them, one per turn. */
export function asyncPieces(
  pieces: readonly Uint8Array[],
): AsyncIterable<Uint8Array> {
  return (async function* deliver() {
    for (const piece of pieces) {
      await Promise.resolve();
      yield piece;
    }
  })();
}

/** A file stream whose first read fails. */
export function failingPieces(): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(new Error('read failed')),
    }),
  };
}
