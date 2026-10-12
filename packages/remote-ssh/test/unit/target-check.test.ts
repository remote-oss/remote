/**
 * @fileoverview F-2205's resolver rows (7.E1 to 7.E10) through the assembled connect: over the real machine and the
 * real `ssh` client, the connector the resolver calls, and no host. A rejected name never reaches `ssh`; the names
 * `ssh` itself refuses are refused at the configuration lookup, before any network.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decodeAuthority, type Failed} from 'lib-authority';
import {createLogger, type Level} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {ConnectMachine} from '../../src/connect-ports.ts';
import {connectAssemblyOf} from '../../src/connect-ports.ts';
import {nodeFacts, nodeMachineOf} from '../../src/node-machine.ts';
import {PROFILE, surfacesOf} from './server-steps.fixture.ts';

/** What the settings host gives the connect; every other setting is undefined. */
const DEFAULTS: Readonly<Record<string, unknown>> = {
  'remote.SSH.useLocalServer': true,
  'remote.SSH.path': '',
  'remote.SSH.configFile': '',
  'remote.SSH.connectTimeout': 15,
  'remote.SSH.remotePlatform': {},
};

/** Whether an OpenSSH client runs at all: the rows that reach `ssh` need it. */
function sshUsable(): boolean {
  return spawnSync('ssh', ['-V'], {timeout: 5000}).status === 0;
}

describe("F-2205's resolver rows through the real connect (card connect-22, #325)", function () {
  this.timeout(20000);

  let storage: string;

  before(async () => {
    storage = await mkdtemp(join(tmpdir(), 'target-check-'));
  });

  after(async () => {
    await rm(storage, {recursive: true, force: true});
  });

  /** The connect the resolver runs for the host's `ssh-remote` authority, as the extension assembles it. */
  async function connectTo(hostText: string): Promise<[Failed, string[]]> {
    const decoded = decodeAuthority(`ssh-remote+${hostText}`);
    if ('malformed' in decoded) {
      throw new Error(
        `the row's host text is malformed: ${JSON.stringify(decoded)}`,
      );
    }
    const machine = nodeMachineOf(
      {
        extensionFolder: '/nonexistent/extension',
        storageFolder: storage,
        runtime: process.execPath,
        profile: PROFILE,
        httpGet: () => Promise.reject(new Error('no download in this test')),
      },
      {...nodeFacts(), environment: {...process.env}},
    );
    const started: string[] = [];
    const recordingMachine: ConnectMachine = {
      ...machine,
      spawner: specification => {
        started.push(specification.program);
        return machine.spawner(specification);
      },
    };
    const surfaces = surfacesOf(
      {inspectSetting: settingId => ({defaultValue: DEFAULTS[settingId]})},
      template => template,
      () => undefined,
    );
    const logger = createLogger(new MemorySink(), {
      minimumLevel: (): Level => 'info',
    });
    const result = await connectAssemblyOf(
      surfaces,
      recordingMachine,
      logger,
    ).connector.connect({
      target: decoded.target,
      rawHostString: decoded.rawHostString,
      attempt: 1,
      isReconnection: false,
      windowId: 'window-1',
      windowWorkspace: undefined,
    });
    if (!('kind' in result)) {
      throw new Error('the row expected a failure, but the connect worked');
    }
    return [result, started];
  }

  it('F-2205 AC-2, 7.E1: an option-looking name is refused as an invalid setting', async () => {
    const [result] = await connectTo('-oProxyCommand=x');
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S119', values: ['-']}],
    );
  });

  it('F-2205 AC-3, 7.E1: a refused option-looking name starts no process', async () => {
    const [, started] = await connectTo('-oProxyCommand=x');
    deepStrictEqual(started, []);
  });

  it('F-2205 AC-4, 7.E2: a percent in the host is refused with the character', async () => {
    const [result] = await connectTo('a%b');
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S120', values: ['%']}],
    );
  });

  it("F-2205 AC-5: a host of a%b'c is refused at the apostrophe", async () => {
    const [result] = await connectTo("a%b'c");
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S120', values: ["'"]}],
    );
  });

  it('F-2205 AC-5: a host of a!b`c is refused at the backtick', async () => {
    const [result] = await connectTo('a!b`c');
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S120', values: ['`']}],
    );
  });

  it('F-2205 AC-5: a host of a`%b is refused at the backtick', async () => {
    const [result] = await connectTo('a`%b');
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S120', values: ['`']}],
    );
  });

  it('F-2205 AC-6, 7.E3: a user starting with a dash is refused', async () => {
    const [result] = await connectTo('-u@h.invalid');
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S121', values: ['-']}],
    );
  });

  it('F-2205 AC-7, 7.E4: a forbidden user character is refused with it', async () => {
    const [result] = await connectTo('u!x@h.invalid');
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S122', values: ['!']}],
    );
  });

  it('F-2205 AC-3: a refused user starts no process', async () => {
    const [, started] = await connectTo('u!x@h.invalid');
    deepStrictEqual(started, []);
  });

  it('F-2205 AC-8: a bad host is refused before a bad user', async () => {
    const [result] = await connectTo('-u@-h');
    deepStrictEqual(
      [result.kind, result.reason],
      ['invalidSetting', {id: 'S119', values: ['-']}],
    );
  });

  it('F-2205 AC-10, 7.E5: a name `ssh` refuses fails as unreachable (skipped without an OpenSSH client)', async function () {
    if (!sshUsable()) {
      this.skip();
    }
    const [result, started] = await connectTo('a;b');
    deepStrictEqual(
      [result.kind, result.reason, started.includes('ssh')],
      ['unreachable', {id: 'S079'}, true],
    );
  });

  it('F-2205 AC-12, 7.E6: a refused username fails with no reason (skipped without an OpenSSH client)', async function () {
    if (!sshUsable()) {
      this.skip();
    }
    const [result, started] = await connectTo('u;x@h.invalid');
    deepStrictEqual(
      [result.reason, started.includes('ssh')],
      [undefined, true],
    );
  });

  it('F-2205 AC-11, 7.E10: _host passes the check, and fails as ssh\u2019s (skipped without an OpenSSH client)', async function () {
    if (!sshUsable()) {
      this.skip();
    }
    const [result] = await connectTo('_host');
    strictEqual(result.kind === 'invalidSetting', false);
  });

  it('F-2205 AC-11, 7.E10: h- passes the check, and fails as ssh\u2019s (skipped without an OpenSSH client)', async function () {
    if (!sshUsable()) {
      this.skip();
    }
    const [result] = await connectTo('h-');
    strictEqual(result.kind === 'invalidSetting', false);
  });

  it('F-2205 AC-11, 7.E10: a*b passes the check, and fails as ssh\u2019s (skipped without an OpenSSH client)', async function () {
    if (!sshUsable()) {
      this.skip();
    }
    const [result] = await connectTo('a*b');
    strictEqual(result.kind === 'invalidSetting', false);
  });
});
