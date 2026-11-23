/**
 * @fileoverview The environment the editor is started with by `devcontainer open`: the launcher runs as a Node inside
 * the editor's program, and the shell it was typed in may be an integrated terminal of another window, so nothing that
 * makes the program run as a Node or ties it to that window is passed on.
 */

/** The variables that make the editor's program a Node. */
const NODE_MODE = 'ELECTRON_RUN_AS_NODE';

/** The prefix of the variables the editor sets for the processes of a window. */
const WINDOW_PREFIX = 'VSCODE_';

/** The environment `environment` gives the editor that `open` starts. */
export function editorEnvironmentOf(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => name !== NODE_MODE && !name.startsWith(WINDOW_PREFIX),
    ),
  );
}
