/**
 * @fileoverview A resolver host editor for the tests of a family extension: it records what the host did, in order,
 * into `events`, keeps the resolver it was given so that a test can resolve through it, and lets a test cancel the
 * running progress.
 */

import type {EditorResolver, ResolverEditor} from '../resolver/host.ts';

/** The fake editor and what a test can do with it. */
export interface RecordingResolverEditor {
  editor: ResolverEditor;
  /** The resolver the host registered last, or nothing before it registers. */
  registered(): EditorResolver | undefined;
  /** Cancels the progress that is running, as the user's Cancel would; does nothing when none runs. */
  cancelProgress(): void;
  /** Calls each timer that is still pending once, as if its time had passed. */
  fireTimers(): void;
  /** Whether every progress the editor was asked for has ended. */
  progressSettled(): boolean;
}

/**
 * The fake editor. It records `register <prefix>`, `unregister <prefix>`, `progress <title>`, `phase <text>`,
 * `phase <text> (details)`, `timer <milliseconds>`, `notAvailable <message> <handled>`, `temporarilyNotAvailable <message>`, `reload` and `closeRemote`.
 */
export function recordingResolverEditor(
  events: string[],
  window: {windowId: string; workspace?: string} = {windowId: 'window-1'},
): RecordingResolverEditor {
  let resolver: EditorResolver | undefined;
  let cancel: (() => void) | undefined;
  const timers = new Set<() => void>();
  let running = 0;
  const editor: ResolverEditor = {
    registerRemoteAuthorityResolver: (authorityPrefix, registered) => {
      events.push(`register ${authorityPrefix}`);
      resolver = registered;
      return {
        dispose: () => {
          events.push(`unregister ${authorityPrefix}`);
        },
      };
    },
    progress: {
      withProgress: async (request, task) => {
        events.push(`progress ${request.title}`);
        cancel = request.onCancel;
        running += 1;
        try {
          return await task((text, details, increment) => {
            events.push(
              (details ? `phase ${text} (details)` : `phase ${text}`) +
                (increment === undefined ? '' : ` +${String(increment)}`),
            );
          });
        } finally {
          cancel = undefined;
          running -= 1;
        }
      },
    },
    startTimer: (milliseconds, callback) => {
      events.push(`timer ${String(milliseconds)}`);
      timers.add(callback);
      return () => {
        timers.delete(callback);
      };
    },
    notAvailable: (message, handled) => {
      events.push(`notAvailable ${String(message)} ${String(handled)}`);
      return new Error(message);
    },
    temporarilyNotAvailable: message => {
      events.push(`temporarilyNotAvailable ${String(message)}`);
      return new Error(message);
    },
    windowId: () => window.windowId,
    windowWorkspace: () => window.workspace,
    reloadWindow: () => {
      events.push('reload');
      return Promise.resolve();
    },
    closeRemote: () => {
      events.push('closeRemote');
      return Promise.resolve();
    },
  };
  return {
    editor,
    registered: () => resolver,
    cancelProgress: () => {
      cancel?.();
    },
    fireTimers: () => {
      for (const callback of [...timers]) {
        timers.delete(callback);
        callback();
      }
    },
    progressSettled: () => running === 0,
  };
}
