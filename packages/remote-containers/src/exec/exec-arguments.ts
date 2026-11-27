/**
 * @fileoverview The `docker exec` arguments of the exec channel and the exec dialer. Environment values never appear
 * here: a variable goes as its name alone, and its value reaches the container through the `docker` process's own
 * environment, so no value shows in `ps` or in `docker inspect`.
 */

import {preludeCommand, TREE_KILL_SCRIPT} from 'lib-host';

/** The names a shell accepts for a variable. */
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether `name` is a variable name `docker exec -e` and a shell both take. */
export function isEnvironmentName(name: string): boolean {
  return ENVIRONMENT_NAME.test(name);
}

/**
 * Runs as `user` a script whose first `scriptByteCount` bytes on standard input a prelude evaluates, with the variables
 * named passed on; the rest of the input is the script's own. `front` runs in the shell before the prelude reads anything.
 */
export function scriptArguments(
  containerId: string,
  user: string,
  environmentNames: readonly string[],
  scriptByteCount: number,
  front: string,
): string[] {
  return [
    'exec',
    '-i',
    '--user',
    user,
    ...environmentNames.flatMap(name => ['-e', name]),
    containerId,
    'sh',
    '-c',
    front + preludeCommand(scriptByteCount),
  ];
}

/** Ends, as `user`, the process tree of the shell `processId` in the container, with lib-host's tree-kill script. */
export function treeKillArguments(
  containerId: string,
  user: string,
  processId: number,
): string[] {
  return [
    'exec',
    '--user',
    user,
    containerId,
    'sh',
    '-c',
    TREE_KILL_SCRIPT,
    'tree-kill',
    String(processId),
  ];
}

/** Unpacks a tar archive read from standard input into `directory`. */
export function copyArguments(
  containerId: string,
  user: string,
  directory: string,
): string[] {
  return [
    'exec',
    '-i',
    '--user',
    user,
    containerId,
    'tar',
    '-x',
    '-f',
    '-',
    '-C',
    directory,
  ];
}

/** Runs the relay script with the installed server's `node` to carry bytes to `port` on the container's loopback. */
export function dialArguments(
  containerId: string,
  user: string,
  nodePath: string,
  relayScriptPath: string,
  port: number,
): string[] {
  return [
    'exec',
    '-i',
    '--user',
    user,
    containerId,
    nodePath,
    relayScriptPath,
    String(port),
  ];
}

/** Runs the relay host with the installed server's `node`, listening on each `<kind>=<socket path>` of `sockets`. */
export function relayHostArguments(
  containerId: string,
  user: string,
  nodePath: string,
  scriptPath: string,
  sockets: readonly string[],
): string[] {
  return [
    'exec',
    '-i',
    '--user',
    user,
    containerId,
    nodePath,
    scriptPath,
    ...sockets,
  ];
}
