/**
 * @fileoverview The text of the two launchers that `cli-bin` holds: constant, with no path pasted into them. They read
 * the editor's program and the extension's folder from the data files beside them at run time, and run the launcher
 * program on the editor's own Node with the arguments they were given.
 */

/** The file that holds the extension's install folder; the launchers read it. */
export const EXTENSION_PATH_FILE = 'remote-containers-path';

/** The file that holds the editor's program; the launchers read it. */
export const EDITOR_PATH_FILE = 'vscode-path';

/** The launcher program, inside the extension's install folder. */
const LAUNCHER_PROGRAM = 'dist/cli-launcher.js';

/**
 * The POSIX launcher. It follows its own link, if it is one (the symlink `devcontainer` install makes in `~/bin`), to
 * the folder its data files are in; `readlink` without `-f` is all macOS and busybox have.
 */
export const POSIX_LAUNCHER = `#!/usr/bin/env sh
self="$0"
while [ -h "$self" ]; do
  folder="$(cd "$(dirname "$self")" && pwd -P)"
  target="$(readlink "$self")"
  case "$target" in
    /*) self="$target" ;;
    *) self="$folder/$target" ;;
  esac
done
here="$(cd "$(dirname "$self")" && pwd -P)"
ELECTRON_RUN_AS_NODE=1 exec "$(cat "$here/${EDITOR_PATH_FILE}")" "$(cat "$here/${EXTENSION_PATH_FILE}")/${LAUNCHER_PROGRAM}" "$@"
`;

/** The Windows launcher: the arguments go on as `%*`, and nothing of them is quoted again. */
export const WINDOWS_LAUNCHER = `@echo off\r
setlocal\r
set /p EDITOR_PATH=<"%~dp0${EDITOR_PATH_FILE}"\r
set /p EXTENSION_PATH=<"%~dp0${EXTENSION_PATH_FILE}"\r
set ELECTRON_RUN_AS_NODE=1\r
"%EDITOR_PATH%" "%EXTENSION_PATH%\\dist\\cli-launcher.js" %*\r
exit /b %ERRORLEVEL%\r
`;
