/**
 * @fileoverview The forwards of a connection: once core has the connection, a notice is shown for each entry that
 * starts with a dash, and once the port attributes the connection wrote are in effect in the window, one tunnel is
 * opened per declared forward over core's own tunnel service. A tunnel that cannot be opened is logged and dropped;
 * nothing is shown for it.
 */

import type {Scheduler} from 'lib-helper';
import type {Logger} from 'lib-log';
import {
  untilAttributesInEffect,
  type AttributeEvents,
} from './attributes-in-effect.ts';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  declaredForwards,
  defaultProtocolOf,
  type DeclaredPorts,
} from './declared-forwards.ts';

/** The English template of each text of the forwards, by its string id. */
const PORT_TEMPLATES = {
  S278: 'Port number must not start with a dash: {0}',
} as const;

/** The editor's way to open a tunnel to a port of the remote side. */
export interface TunnelHost {
  openTunnel(options: {
    remoteAddress: {host: string; port: number};
    protocol?: string;
  }): PromiseLike<unknown>;
}

/** What the forwarder needs of its surroundings. */
export interface ForwarderPorts {
  tunnels: TunnelHost;
  /** Shows `text` as an error that blocks nothing and has no buttons. */
  showError(text: string): unknown;
  logger: Pick<Logger, 'warn' | 'info'>;
  translate: Translate;
  /** The window's port attribute settings, which the forwards wait for. */
  attributes: AttributeEvents;
  scheduler: Scheduler;
}

/** The forwarder of the extension. */
export interface Forwarder {
  /**
   * Shows the notices for the dashed entries of `declared`, waits for its port attributes to be in effect, and opens
   * the forwards it names; it never rejects.
   */
  forward(declared: DeclaredPorts | undefined): Promise<void>;
}

/** A forwarder over the editor's tunnels. */
export function forwarderOf(ports: ForwarderPorts): Forwarder {
  return {
    forward: async declared => {
      if (declared === undefined) {
        return;
      }
      const {forwards, dashed} = declaredForwards(
        declared.forwardPorts,
        declared.portsAttributes,
      );
      for (const written of dashed) {
        void ports.showError(
          filled(ports.translate, PORT_TEMPLATES.S278, [written]),
        );
      }
      const wait = await untilAttributesInEffect(
        declared.attributeSettings ?? {},
        ports.attributes,
        ports.scheduler,
      );
      if (wait === 'bound') {
        ports.logger.info(
          'the declared forwards open before the port attributes are in effect in the window',
        );
      }
      for (const {host, port} of forwards) {
        const protocol = defaultProtocolOf(
          port,
          declared.portsAttributes,
          declared.otherPortsAttributes,
        );
        try {
          await ports.tunnels.openTunnel({
            remoteAddress: {host, port},
            ...(protocol === undefined ? {} : {protocol}),
          });
        } catch (caught) {
          ports.logger.warn(
            `the forward of ${host}:${String(port)} was refused: ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        }
      }
    },
  };
}
