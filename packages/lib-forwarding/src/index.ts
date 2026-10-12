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
  SOCKS_HANDSHAKE_MILLISECONDS,
  TUNNEL_WAIT_LIMITS,
} from './window-tunnel/bounds.ts';
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
export {nodeLocalPort} from './window-tunnel/node-network.ts';
export {
  effectiveUseLocalServer,
  loginsPerConnect,
  selectTunnelPath,
  type ForwardingHolder,
  type TunnelPath,
  type TunnelSettings,
  tunnelDestination,
  userForwardingHolder,
} from './tunnel-path/select.ts';
export {
  type DefaultForwards,
  parseDefaultForwards,
  type SkippedEntry,
  type SkipReason,
  type TunnelRequest,
} from './defaults/entries.ts';
export {
  type EnvironmentAddress,
  type EnvironmentTunnel,
  environmentTunnels,
  type EnvironmentTunnels,
  type ForwardSkipReason,
  type SkippedForward,
} from './defaults/environment.ts';
export {shouldApplyDefaults} from './defaults/policy.ts';
