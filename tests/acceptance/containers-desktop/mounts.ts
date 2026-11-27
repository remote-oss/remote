import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

/** One mount as the container's `HostConfig.Mounts` holds it: what the product asked the engine for. */
export interface HostMount {
  Type: string;
  Source: string;
  Target: string;
  Consistency?: string;
}

/**
 * The mounts the engine was asked for when container `containerId` was created. The runtime `.Mounts` shows no
 * consistency, so it is never read for one.
 */
async function hostMountsOf(containerId: string): Promise<HostMount[]> {
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{json .HostConfig.Mounts}}',
    containerId,
  ]);
  return (JSON.parse(stdout) as HostMount[] | null) ?? [];
}

/** The mount of container `containerId` whose target is `target`, when it has one. */
export async function bindAt(
  containerId: string,
  target: string,
): Promise<HostMount | undefined> {
  return (await hostMountsOf(containerId)).find(
    mount => mount.Target === target,
  );
}
