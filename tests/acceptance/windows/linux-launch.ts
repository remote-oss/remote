/**
 * @fileoverview The guard of a row that drives the launch host's own display: its key driver is an X11 tool, so the
 * row runs only on a Linux launch, and is pending on the other platforms, never touching the display.
 */

/** The least of mocha's test context a row needs: the skip that keeps it off a display it cannot drive. */
interface SkipContext {
  skip(): void;
}

/** A row that runs on its test context. */
type LinuxRow = (this: SkipContext) => Promise<void>;

/** Whether the launch host is Linux, the only platform with the display's X11 tools. */
function isLinuxLaunch(): boolean {
  return process.platform === 'linux';
}

/**
 * Wraps `runRow` so that it runs on a Linux launch and is pending on the other platforms: the display's X11 tools
 * are absent there, and a row that drove them would fail before it read anything.
 */
export function linuxOnly(runRow: LinuxRow): LinuxRow {
  function guarded(this: SkipContext): Promise<void> {
    if (!isLinuxLaunch()) {
      this.skip();
      return Promise.resolve();
    }
    return runRow.call(this);
  }
  return guarded;
}
