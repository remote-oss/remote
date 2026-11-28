/**
 * @fileoverview The relay as the agent sees it: the one tunnel it registers, what it asks of the relay's management
 * service, and the text of a refusal. The service behind the port is the dev tunnels SDK's management client, in
 * `sdk.ts`.
 */

/** The port of the editor's control protocol, which the tunnel always holds. */
export const CONTROL_PORT = 31545;

/** The tunnel as the relay holds it: its ids, its name and the ports it carries. */
export interface RelayTunnel {
  tunnelId: string;
  clusterId: string;
  name: string;
  ports: readonly number[];
}

/** A refusal or a failure of the relay's service, with the text the user is shown: the relay's own, or ours. */
export class RelayError extends Error {
  /** The HTTP status the relay answered, or 0 when it could not be reached. */
  readonly status: number;

  /** The failure with the HTTP status the relay answered, or 0 when it could not be reached, and the text for the user. */
  constructor(status: number, text: string) {
    super(text);
    this.status = status;
  }
}

/** What the agent asks of the relay's management service. */
export interface TunnelService {
  /** The tunnel with the stored ids, or none when the relay has no such tunnel. */
  get(tunnelId: string, clusterId: string): Promise<RelayTunnel | undefined>;
  /** Creates a tunnel named `name` under a fresh id. */
  create(name: string): Promise<RelayTunnel>;
  /** Gives the tunnel `name`, keeping its id. */
  rename(tunnelId: string, clusterId: string, name: string): Promise<void>;
  /** Deletes the tunnel; false when the relay had none. */
  delete(tunnelId: string, clusterId: string): Promise<boolean>;
  /** Adds the port to the tunnel, as a private port. */
  addPort(tunnelId: string, clusterId: string, port: number): Promise<void>;
}
