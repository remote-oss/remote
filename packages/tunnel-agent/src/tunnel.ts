/**
 * @fileoverview The machine's tunnel on the relay: registering it on a first start, finding it again on every later
 * one, renaming it and unregistering it. The record of the tunnel in the state folder is written at once after the
 * relay creates it, so a start that fails after that finds the tunnel again and does not create a second one against
 * the relay's limit.
 */

import {
  readTunnelRecord,
  removeStateFile,
  type TunnelRecord,
  writeTunnelRecord,
} from './state.ts';
import {
  CONTROL_PORT,
  RelayError,
  type RelayTunnel,
  type TunnelService,
} from './relay.ts';

/** The longest name the relay accepts. */
const NAME_LONGEST = 49;

/** The fewest characters a name needs. */
const NAME_SHORTEST = 3;

/** The name of a machine whose host name leaves nothing the relay accepts. */
const FALLBACK_NAME = 'my-machine';

/** What the registration needs besides the relay. */
export interface TunnelContext {
  service: TunnelService;
  /** The state folder of the agent. */
  folder: string;
  /** The machine's host name, from which a first tunnel is named. */
  hostName: string;
  /** Says one line to the user. */
  report: (line: string) => void;
}

/**
 * A tunnel name from a host name, by the relay's rule: lower case letters, digits and `-`, with a letter or a digit at
 * each end, 3 to 49 characters.
 */
export function tunnelNameOf(hostName: string): string {
  const name = hostName
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/gu, '-')
    .slice(0, NAME_LONGEST)
    .replaceAll(/^-+|-+$/gu, '');
  return name.length < NAME_SHORTEST ? FALLBACK_NAME : name;
}

/** The record of `tunnel`, as the state folder keeps it. */
function recordOf(tunnel: RelayTunnel): TunnelRecord {
  return {
    tunnelId: tunnel.tunnelId,
    clusterId: tunnel.clusterId,
    name: tunnel.name,
  };
}

/** Says what the relay refused, in its own words, and tells that the run ends. */
function refused(context: TunnelContext, caught: unknown): undefined {
  if (!(caught instanceof RelayError)) {
    throw caught;
  }
  context.report(caught.message);
  return undefined;
}

/** Creates the tunnel, keeps its record, then gives it the control port; none when the relay refuses. */
async function createdTunnel(
  context: TunnelContext,
  name: string,
): Promise<RelayTunnel | undefined> {
  try {
    const created = await context.service.create(name);
    writeTunnelRecord(context.folder, recordOf(created));
    await context.service.addPort(
      created.tunnelId,
      created.clusterId,
      CONTROL_PORT,
    );
    return {...created, ports: [...created.ports, CONTROL_PORT]};
  } catch (caught) {
    refused(context, caught);
    return undefined;
  }
}

/** The stored tunnel when the relay still holds it, with the control port it must carry; none when it refuses. */
async function foundTunnel(
  context: TunnelContext,
  record: TunnelRecord,
  asked: string | undefined,
): Promise<RelayTunnel | undefined | 'gone'> {
  try {
    const found = await context.service.get(record.tunnelId, record.clusterId);
    if (found === undefined) {
      return 'gone';
    }
    if (asked !== undefined && asked !== record.name) {
      context.report(
        `the tunnel is named ${record.name}; tunnel-agent rename ${asked} changes it`,
      );
    }
    if (found.ports.includes(CONTROL_PORT)) {
      return found;
    }
    await context.service.addPort(
      found.tunnelId,
      found.clusterId,
      CONTROL_PORT,
    );
    return {...found, ports: [...found.ports, CONTROL_PORT]};
  } catch (caught) {
    refused(context, caught);
    return undefined;
  }
}

/**
 * The tunnel of this machine: created on a first start, with `asked` or the host's name; found again by its stored
 * ids on every later one, or created anew under a new id when the relay no longer holds it. None when the relay
 * refuses, after the user was told why; the stored record is touched only by a creation.
 */
export async function registeredTunnel(
  context: TunnelContext,
  asked: string | undefined,
): Promise<RelayTunnel | undefined> {
  const record = readTunnelRecord(context.folder);
  if (record === undefined) {
    return createdTunnel(context, asked ?? tunnelNameOf(context.hostName));
  }
  const found = await foundTunnel(context, record, asked);
  return found === 'gone' ? createdTunnel(context, record.name) : found;
}

/** The line that says no tunnel is registered here. */
const NONE_REGISTERED = 'no tunnel is registered on this machine';

/** Renames the registered tunnel, keeping its id; the exit status of the command. */
export async function renameTunnel(
  context: TunnelContext,
  name: string,
): Promise<number> {
  const record = readTunnelRecord(context.folder);
  if (record === undefined) {
    context.report(NONE_REGISTERED);
    return 1;
  }
  try {
    await context.service.rename(record.tunnelId, record.clusterId, name);
  } catch (caught) {
    refused(context, caught);
    return 1;
  }
  writeTunnelRecord(context.folder, {...record, name});
  context.report(`the tunnel is named ${name}`);
  return 0;
}

/** Deletes the registered tunnel on the relay, then forgets its record; the exit status of the command. */
export async function unregisterTunnel(
  context: TunnelContext,
): Promise<number> {
  const record = readTunnelRecord(context.folder);
  if (record === undefined) {
    context.report(NONE_REGISTERED);
    return 1;
  }
  try {
    await context.service.delete(record.tunnelId, record.clusterId);
  } catch (caught) {
    refused(context, caught);
    return 1;
  }
  removeStateFile(context.folder, 'tunnel.json');
  context.report('the tunnel is unregistered');
  return 0;
}
