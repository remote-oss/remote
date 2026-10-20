/**
 * @fileoverview The host probe (V2): runs the probe step and turns its facts into what the planner and the rest of
 * the lifecycle read.
 */

import type {ChannelFailure, HostChannel} from 'lib-host';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import type {ResultBlock} from '../scripts/result-block.ts';
import {runStep} from './run-step.ts';

/** The architecture tokens of the server builds of Code - OSS, by the host's machine name. */
const ARCHITECTURES = [
  'x64',
  'arm64',
  'armhf',
  'ppc64le',
  'riscv64',
  'loong64',
  's390x',
] as const;

/** The architecture token of a host. */
export type HostArchitecture = (typeof ARCHITECTURES)[number];

/** What the probe found on a host that can run a server. */
export interface ProbedHost {
  operatingSystem: 'linux' | 'darwin';
  architecture: HostArchitecture;
  libc: 'glibc' | 'musl' | 'unknown';
  release: string;
  home: string;
  temporaryFolder: string;
  /** The host's `$SHELL` as the startup files left it: a path, or empty when the host reports none. */
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
  /** Whether the shared tree the install goes into is complete; false when the install has no tree. */
  treeComplete: boolean;
}

/** Why the probe gave no host. */
export type ProbeFailure =
  | {kind: 'unsupportedPlatform'; reported: string}
  | {
      kind: 'unsupportedArch';
      reported: string;
      libc: 'glibc' | 'musl' | 'unknown';
    }
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

/** The C library a fact names; any other value is unknown. */
function libcOf(fact: string | undefined): 'glibc' | 'musl' | 'unknown' {
  return fact === 'glibc' || fact === 'musl' ? fact : 'unknown';
}

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
      libc: libcOf(facts.libc),
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
      treeComplete: block.serverFacts.treeComplete === 'yes',
    },
  };
}

/** The host's platform as the templates name it: a musl Linux is `alpine`. */
export function templatePlatformOf(host: ProbedHost): {
  operatingSystem: ProbedHost['operatingSystem'] | 'alpine';
  architecture: ProbedHost['architecture'];
} {
  return {
    operatingSystem: host.libc === 'musl' ? 'alpine' : host.operatingSystem,
    architecture: host.architecture,
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
      failure: {
        kind: 'unsupportedArch',
        reported: block.hostFacts.arch ?? '',
        libc: libcOf(block.hostFacts.libc),
      },
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
