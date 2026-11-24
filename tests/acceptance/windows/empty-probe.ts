/**
 * @fileoverview The probe of a window that has no folder, such as one that `Connect Current Window to Host...` reloads
 * onto a host: the window agent writes a relative file under the window's first folder, and says "the window has no
 * folder" when there is none, so a window without one proves its connection by a file it writes through its remote file
 * system, at a full URI that names the host.
 */

/** Where a folderless window writes its probe, on the host, and the address the agent is given for it. */
export interface EmptyProbe {
  /** The folder of the host's `user` that holds the probe. */
  folder: string;
  /** The file the window writes in it, on the host. */
  file: string;
  /** The full URI of that file in the window's remote file system, which the agent writes as it is. */
  uri: string;
}

/** The probe of window `name`, on the host that authority `alias` reaches, in the home of `user`. */
export function emptyProbe(
  name: string,
  alias: string,
  user = 'harness',
): EmptyProbe {
  const folder = `/home/${user}/${name}-probe`;
  const file = `${folder}/probe.txt`;
  return {folder, file, uri: `vscode-remote://ssh-remote+${alias}${file}`};
}
