/**
 * @fileoverview The ports of `remote.SSH.defaultForwardedPorts`, forwarded once a connection has worked: one tunnel
 * request to the editor for each entry the setting gives, all started together, none of them able to fail the
 * connection. Nothing is shown; what is skipped or fails is logged.
 */

import type {DefaultForwards} from 'lib-forwarding';
import type {Logger} from 'lib-log';

/** What the editor is asked for one forward. */
export interface TunnelOptions {
  remoteAddress: {host: string; port: number};
  localAddressPort: number;
  label?: string;
}

/** The editor's tunnel service. */
export interface TunnelOpener {
  openTunnel(options: TunnelOptions): PromiseLike<unknown>;
}

/** The text of a failure. */
function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Opens a tunnel for each request of the setting; a request that fails is logged and the others still open. */
export async function applyDefaults(
  forwards: DefaultForwards,
  opener: TunnelOpener,
  logger: Logger,
): Promise<void> {
  if (forwards.settingProblem !== undefined) {
    logger.info('defaultForwardedPorts is not a list, so no port is forwarded');
  }
  for (const entry of forwards.skipped) {
    logger.info(
      `defaultForwardedPorts entry ${String(entry.index)} is skipped: ${entry.reason}`,
    );
  }
  await Promise.all(
    forwards.requests.map(async request => {
      try {
        await opener.openTunnel({
          remoteAddress: {host: request.remoteHost, port: request.remotePort},
          localAddressPort: request.localPort,
          ...(request.label === undefined ? {} : {label: request.label}),
        });
      } catch (caught) {
        logger.warn(
          `the default forward of port ${String(request.remotePort)} did not open: ${messageOf(caught)}`,
        );
      }
    }),
  );
}
