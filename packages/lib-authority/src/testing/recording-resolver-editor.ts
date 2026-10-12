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
}

/**
 * The fake editor. It records `register <prefix>`, `unregister <prefix>`, `progress <title>`, `phase <text>`,
 * `notAvailable <message> <handled>`, `temporarilyNotAvailable <message>`, `reload` and `closeRemote`.
 */
export function recordingResolverEditor(
  events: string[],
  window: {windowId: string; workspace?: string} = {windowId: 'window-1'},
): RecordingResolverEditor {
  let resolver: EditorResolver | undefined;
  let cancel: (() => void) | undefined;
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
        try {
          return await task(text => {
            events.push(`phase ${text}`);
          });
        } finally {
          cancel = undefined;
        }
      },
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
  };
}
