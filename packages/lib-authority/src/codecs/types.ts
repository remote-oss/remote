/** The authority families a codec decodes and encodes. */
export type Family =
  | 'ssh-remote'
  | 'wsl'
  | 'dev-container'
  | 'attached-container'
  | 'k8s-container'
  | 'apple-container'
  | 'exec'
  | 'tunnel';

/** A decoded ssh-remote target: a config alias, or a host with an optional user and port. */
export type SshTarget =
  | {kind: 'alias'; alias: string}
  | {kind: 'host'; hostName: string; user?: string; port?: number};

/** A decoded wsl target: the distro (empty is the default distro) and an optional outer hop. */
export interface WslTarget {
  distro: string;
  outer?: DecodedTarget;
}

/** A decoded container target: the family's own payload and an optional outer hop. */
export interface ContainerTarget {
  payload: string;
  outer?: DecodedTarget;
}

/** A decoded tunnel target: the tunnel name and an optional distro. */
export interface TunnelTarget {
  tunnelName: string;
  distro?: string;
}

/** A decoded target: its family, the family's own target shape, and the payload exactly as written. */
export interface DecodedTarget {
  family: Family;
  target: SshTarget | WslTarget | ContainerTarget | TunnelTarget;
  rawHostString: string;
}

/** A payload that is not a valid target: its family, the payload, and why it was refused. */
export interface MalformedAuthority {
  family: Family;
  payload: string;
  reason: string;
}

/** The result of a codec's decode: the target and the payload as written, or the refusal. */
export type DecodedOrMalformed<T> =
  {target: T; rawHostString: string} | {malformed: MalformedAuthority};

/** A codec decodes a payload into a target, encodes a target back, and gives the target's label. */
export interface Codec<T> {
  decode(payload: string): DecodedOrMalformed<T>;
  encode(target: T): string;
  label(target: T): string;
}
