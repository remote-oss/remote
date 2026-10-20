/**
 * @fileoverview What the files of the POSIX bootstrap script's rows share: the host each test runs on, its hooks, and
 * the readers of a run's result block.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {type ScriptParameters} from '../../src/index.ts';
import {
  blockOf,
  fakeHost,
  type FakeHost,
  installFolder,
  parametersFor,
  runScript,
  single,
  type Stub,
} from './fake-host.ts';

/** The status and the named facts of a run's result block. */
export function statusAndFacts(
  host: FakeHost,
  request: Parameters<typeof blockOf>[1],
  parameters: ScriptParameters,
  names: readonly string[],
  options: Parameters<typeof blockOf>[3] = {},
): unknown {
  const block = blockOf(host, request, parameters, options);
  if (block === 'none') {
    return 'none';
  }
  const facts: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(block.hostFacts).map(([field, value]) => [
        `host.${field}`,
        value,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(block.serverFacts).map(([field, value]) => [
        `server.${field}`,
        value,
      ]),
    ),
  };
  return {
    status: block.status,
    ...Object.fromEntries(names.map(name => [name, facts[name]])),
  };
}

/** The status alone of a run's result block. */
export function statusOf(
  host: FakeHost,
  request: Parameters<typeof blockOf>[1],
  parameters: ScriptParameters,
  options: Parameters<typeof blockOf>[3] = {},
): string {
  const block = blockOf(host, request, parameters, options);
  return block === 'none' ? 'none' : block.status;
}

/** The server facts of a script run, or none when the run gave no result block. */
export function serverFactsOf(
  host: FakeHost,
  request: Parameters<typeof blockOf>[1],
  parameters: ScriptParameters,
  options: Parameters<typeof blockOf>[3] = {},
): Record<string, string> {
  const block = blockOf(host, request, parameters, options);
  return block === 'none' ? {} : block.serverFacts;
}

/**
 * Puts the lock file of the parameters in the temporary folder, under a name no other fake host shares, so that test
 * runs on one machine cannot meet at one path. Returns the lock file's path.
 */
export function lockInTemporaryFolder(
  host: FakeHost,
  parameters: ScriptParameters,
): string {
  parameters.lock.inTemporaryFolder = true;
  parameters.lock.filePrefix = `boot-lock.${path.basename(path.dirname(host.home))}`;
  return `/tmp/${parameters.lock.filePrefix}.abc123`;
}

/** Another window's link lock on the baseline install: both names exist. Returns the lock file's path. */
export function holdLinkLock(host: FakeHost): string {
  mkdirSync(installFolder(host), {recursive: true});
  const lock = path.join(installFolder(host), 'boot-lock.user.abc123');
  writeFileSync(lock, '');
  writeFileSync(`${lock}.target`, '');
  return lock;
}

/** Removes any server the test started, so no process outlives it. */
function stopServers(host: FakeHost): void {
  runScript(host, single('kill'), parametersFor());
}

/**
 * Registers the hooks every file of the script's rows shares: a new host before each test, and no server left after
 * it. `onHost` receives each host as it is made; the result makes another one, with `stubs` on its path.
 */
export function installHostHooks(
  onHost: (host: FakeHost) => void,
): (stubs?: readonly Stub[]) => void {
  let current: FakeHost | undefined;
  function useHost(stubs?: readonly Stub[]): void {
    current = fakeHost(stubs);
    onHost(current);
  }

  beforeEach(() => {
    useHost();
  });

  afterEach(() => {
    if (current !== undefined) {
      stopServers(current);
    }
  });
  return useHost;
}
