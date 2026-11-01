/**
 * @fileoverview Runs inside the dev container CLI's own process, before its code. Two jobs: Electron reads
 * `ELECTRON_RUN_AS_NODE` once, at start, so the CLI's children must not inherit it; and the CLI's lifecycle commands
 * get a real terminal when the CLI can load `node-pty`, which the editor ships for its own terminal (ADR-0011). The
 * editor's copy is made resolvable to this process's `require` alone: no environment variable is set, so a lifecycle
 * command sees the editor's environment as before. The preload says what it loaded in one marker line on stderr.
 *
 * It also ends the CLI with its build when the extension host that started it is gone. The CLI runs in a process group
 * of its own, so that the host can end the whole group on a cancellation; a window that closes ends the host without
 * telling the extension, and nothing else would end the group then.
 */

import module from 'node:module';
import path from 'node:path';

/** The marker line's name (ADR-0010 rule 1: a new family starts with `remote-oss-`). */
const MARKER = 'remote-oss-cli-preload';

/** The platforms measured with a pty (ADR-0011 decision 6): Linux by its acceptance rows, macOS by a probe run. */
const PTY_PLATFORMS = new Set(['linux', 'darwin']);

/** How often the CLI looks for the process that started it, in milliseconds. */
const PARENT_POLL_MILLISECONDS = 1000;

/** How long the group has to end after SIGTERM before it is killed, in milliseconds. */
const GROUP_GRACE_MILLISECONDS = 5000;

delete process.env.ELECTRON_RUN_AS_NODE;
/** Where the editor keeps `node-pty`: handed by the host, and removed so no child of the CLI sees it. */
const editorModules = process.env.REMOTE_OSS_EDITOR_MODULES;
delete process.env.REMOTE_OSS_EDITOR_MODULES;

/** The marker: whether `node-pty` loads in this process, and which copy did. */
function marker(loaded: boolean, from: 'default' | 'editor' | 'none'): string {
  return `${JSON.stringify({marker: MARKER, nodePty: {loaded, from}})}\n`;
}

if (
  editorModules !== undefined &&
  PTY_PLATFORMS.has(process.platform) &&
  typeof module.registerHooks === 'function'
) {
  let from: 'default' | 'editor' = 'default';
  module.registerHooks({
    resolve: (specifier, context, nextResolve) => {
      if (specifier !== 'node-pty') {
        return nextResolve(specifier, context);
      }
      try {
        return nextResolve(specifier, context);
      } catch {
        from = 'editor';
        return nextResolve(path.join(editorModules, 'node-pty'), context);
      }
    },
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the CLI's own loader is `require`
    require('node-pty');
    process.stderr.write(marker(true, from));
  } catch {
    process.stderr.write(marker(false, 'none'));
  }
} else {
  process.stderr.write(marker(false, 'none'));
}

/** Signals the CLI's whole process group, or the CLI alone when it leads none; a group that is gone is not an error. */
function signalGroup(name: 'SIGTERM' | 'SIGKILL'): void {
  try {
    process.kill(-process.pid, name);
  } catch {
    try {
      process.kill(process.pid, name);
    } catch {
      // The process is already gone, which is what the signal was for.
    }
  }
}

if (process.platform !== 'win32') {
  const startedBy = process.ppid;
  setInterval(() => {
    if (process.ppid !== startedBy) {
      setTimeout(() => {
        signalGroup('SIGKILL');
      }, GROUP_GRACE_MILLISECONDS).unref();
      signalGroup('SIGTERM');
    }
  }, PARENT_POLL_MILLISECONDS).unref();
}
