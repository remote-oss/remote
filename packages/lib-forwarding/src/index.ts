/**
 * @fileoverview lib-forwarding: the local port search the tunneling extensions use — the range parsed from the
 * setting, and the first port a prober finds free.
 */
export type {ParsedRange, PortRange} from './port-search/range.ts';
export {parseRange} from './port-search/range.ts';
export type {
  FindOptions,
  FindOutcome,
  PortProber,
  ProbeAnswer,
} from './port-search/find.ts';
export {findFreePort} from './port-search/find.ts';
export type {
  Dialer,
  Duplex,
  Listening,
  LocalPort,
  TunnelTarget,
} from './window-tunnel/ports.ts';
export {succeedsWithin, type WaitLimits} from './window-tunnel/wait.ts';
export {
  openRelayTunnel,
  type RelayTunnelRequest,
  type WindowAddress,
  type WindowTunnelOutcome,
} from './window-tunnel/relay.ts';
export {
  type ForwardedTunnelRequest,
  openForwardedTunnel,
} from './window-tunnel/forwarded.ts';
export {
  factoryFor,
  type FactoryInit,
  type ForwardedPort,
  type ForwardFailure,
  type ForwardOutcome,
  type ForwardRequest,
  type ReviveReport,
  type TunnelFactory,
  type TunnelFeatures,
} from './window-tunnel/factory.ts';
export {socksDialer, type SocksDialerInit} from './window-tunnel/socks.ts';
