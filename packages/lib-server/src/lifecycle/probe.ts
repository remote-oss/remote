/**
 * @fileoverview The host probe (V2): runs the probe step and turns its facts into what the planner and the rest of
 * the lifecycle read.
 */

import type {ChannelFailure, HostChannel} from 'lib-host';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import type {ResultBlock} from '../scripts/result-block.ts';
import {runStep} from './run-step.ts';

/** What the probe found on a host that can run a server. */
export interface ProbedHost {
  operatingSystem: 'linux' | 'darwin';
  architecture: 'x64' | 'arm64' | 'armhf';
  libc: 'glibc' | 'musl' | 'unknown';
  release: string;
  home: string;
  temporaryFolder: string;
  loginShell: string;
  /** The tools the host has, from `wget`, `curl`, `tar`, `unzip`, `flock` and `gzip`, in that order. */
  tools: readonly string[];
  /** Whether the `wget` it has is BusyBox's. */
  busyboxWget: boolean;
  /** The session's agent socket and display, as the host reported them; empty when unset. */
  sshAuthSock: string;
  display: string;
  /** Whether the server of the probed commit is already installed, and where it would be. */
  installed: boolean;
  installFolder: string;
}

/** Why the probe gave no host. */
export type ProbeFailure =
  | {kind: 'unsupportedPlatform'; reported: string}
  | {kind: 'unsupportedArch'; reported: string}
  | {kind: 'prerequisiteMissing'; missing: readonly string[]}
  | {kind: 'probeFailed'; status: string}
  | {kind: 'unreadableFacts'; field: 'os' | 'arch'}
  | {kind: 'noResultBlock'}
  | {kind: 'channelFailed'; failure: ChannelFailure};

/** The outcome of a probe. */
export type ProbeOutcome =
  {kind: 'probed'; host: ProbedHost} | {kind: 'failed'; failure: ProbeFailure};

/** The tools a host must have for any server install: the archive is a tar file. */
const REQUIRED_TOOLS = ['tar'];

const TOOL_NAMES = ['wget', 'curl', 'tar', 'unzip', 'flock', 'gzip'];

const OPERATING_SYSTEMS = ['linux', 'darwin'] as const;

const ARCHITECTURES = ['x64', 'arm64', 'armhf'] as const;

/** The host a block describes, or the field that no host of this library can have. */
function hostOf(
  block: ResultBlock,
): {host: ProbedHost} | {unreadable: 'os' | 'arch'} {
  const facts = block.hostFacts;
  const operatingSystem = OPERATING_SYSTEMS.find(name => name === facts.os);
  if (operatingSystem === undefined) {
    return {unreadable: 'os'};
  }
  const architecture = ARCHITECTURES.find(name => name === facts.arch);
  if (architecture === undefined) {
    return {unreadable: 'arch'};
  }
  const tools = TOOL_NAMES.filter(name => facts[`tool.${name}`] === 'yes');
  return {
    host: {
      operatingSystem,
      architecture,
      libc:
        facts.libc === 'glibc' || facts.libc === 'musl'
          ? facts.libc
          : 'unknown',
      release: facts.release ?? '',
      home: facts.home ?? '',
      temporaryFolder: facts.tmp ?? '',
      loginShell: facts.shell ?? '',
      tools,
      busyboxWget: facts.wgetBusybox === 'yes',
      sshAuthSock: facts.sshAuthSock ?? '',
      display: facts.display ?? '',
      installed: block.serverFacts.installed === 'yes',
      installFolder: block.serverFacts.installDir ?? '',
    },
  };
}

/** Runs the probe step on a host and reads what it reported. */
export async function probe(
  channel: HostChannel,
  parameters: ScriptParameters,
  cancellation: AbortSignal,
): Promise<ProbeOutcome> {
  const stepRun = await runStep(
    channel,
    {installMode: 'singleScript', step: 'probe'},
    parameters,
    {cancellation},
  );
  if (stepRun.kind === 'channelFailed') {
    return {kind: 'failed', failure: stepRun};
  }
  if (stepRun.kind === 'noResultBlock') {
    return {kind: 'failed', failure: {kind: 'noResultBlock'}};
  }
  const {block} = stepRun;
  if (block.status === 'UnsupportedPlatform') {
    return {
      kind: 'failed',
      failure: {
        kind: 'unsupportedPlatform',
        reported: block.hostFacts.os ?? '',
      },
    };
  }
  if (block.status === 'UnsupportedArch') {
    return {
      kind: 'failed',
      failure: {kind: 'unsupportedArch', reported: block.hostFacts.arch ?? ''},
    };
  }
  if (block.status !== 'Ok') {
    return {
      kind: 'failed',
      failure: {kind: 'probeFailed', status: block.status},
    };
  }
  const read = hostOf(block);
  if ('unreadable' in read) {
    return {
      kind: 'failed',
      failure: {kind: 'unreadableFacts', field: read.unreadable},
    };
  }
  const {host} = read;
  const missing = REQUIRED_TOOLS.filter(name => !host.tools.includes(name));
  return missing.length > 0
    ? {kind: 'failed', failure: {kind: 'prerequisiteMissing', missing}}
    : {kind: 'probed', host};
}
