/**
 * @fileoverview The four Reopen Folder commands over the window's origin: what each of them calls, or refuses, per
 * the origin and the open folder.
 */

import {deepStrictEqual} from 'node:assert';
import type {OpenerHost} from 'lib-authority';
import type {ReopenOrigin} from '../../src/authority/payload.ts';
import {
  reopenOriginHandlersOf,
  type ReopenOriginPorts,
} from '../../src/open/reopen-origin.ts';
import {settled} from './pending.ts';

/** The window the command reads, faked: the origin and the folder it reports, the calls the opener saw, the texts shown. */
function windowOf(
  origin: ReopenOrigin | undefined,
  folderOpen: boolean,
): {ports: ReopenOriginPorts; calls: unknown[][]; texts: string[]} {
  const calls: unknown[][] = [];
  const texts: string[] = [];
  const host: OpenerHost = {
    executeCommand: (command: string, ...parameters: unknown[]) => {
      calls.push([command, ...parameters]);
      return Promise.resolve();
    },
    addressOf: parts => parts,
  };
  const ports: ReopenOriginPorts = {
    origin: () => origin,
    folderOpen: () => folderOpen,
    opener: host,
    inform: text => {
      texts.push(text);
    },
    translate: template => template,
  };
  return {ports, calls, texts};
}

describe('the four Reopen Folder commands over the window origin (card containers-136)', () => {
  const LOCAL: ReopenOrigin = {kind: 'local', folder: '/home/u/project'};

  it('F-0406 AC-1, AC-22: Reopen Locally reopens the origin folder in the same window, re-pointed at it', async () => {
    const {ports, calls, texts} = windowOf(LOCAL, true);
    await reopenOriginHandlersOf(ports).reopenLocally();
    await settled();
    deepStrictEqual(
      [calls, texts],
      [
        [
          [
            'vscode.openFolder',
            {scheme: 'file', path: '/home/u/project'},
            {
              forceNewWindow: false,
              forceReuseWindow: true,
              forceLocalWindow: true,
            },
          ],
        ],
        [],
      ],
    );
  });

  it('F-0406 AC-30: Reopen Locally reopens a workspace window as its workspace file', async () => {
    const {ports, calls, texts} = windowOf(
      {
        kind: 'local',
        folder: '/home/u/project',
        workspaceFile: '/home/u/project/proj.code-workspace',
      },
      true,
    );
    await reopenOriginHandlersOf(ports).reopenLocally();
    await settled();
    deepStrictEqual(
      [calls, texts],
      [
        [
          [
            'vscode.openFolder',
            {scheme: 'file', path: '/home/u/project/proj.code-workspace'},
            {
              forceNewWindow: false,
              forceReuseWindow: true,
              forceLocalWindow: true,
            },
          ],
        ],
        [],
      ],
    );
  });

  it('F-0406 AC-8: Reopen Locally does nothing with no folder open, even with an origin', async () => {
    const {ports, calls, texts} = windowOf(LOCAL, false);
    await reopenOriginHandlersOf(ports).reopenLocally();
    await settled();
    deepStrictEqual([calls, texts], [[], []]);
  });

  it('F-0406 AC-33: Reopen Locally does nothing in a window with no origin', async () => {
    const {ports, calls, texts} = windowOf(undefined, true);
    await reopenOriginHandlersOf(ports).reopenLocally();
    await settled();
    deepStrictEqual([calls, texts], [[], []]);
  });

  it('F-0406 AC-1: an open the editor refuses shows and logs nothing: core reports its own refusal', async () => {
    const {ports, texts} = windowOf(LOCAL, true);
    ports.opener.executeCommand = () => Promise.reject(new Error('refused'));
    await reopenOriginHandlersOf(ports).reopenLocally();
    await settled();
    deepStrictEqual(texts, []);
  });

  it('F-0406 AC-32: each in-remote command shows its own refusal, once, in a window whose origin is local', () => {
    const {ports, calls, texts} = windowOf(LOCAL, true);
    const handlers = reopenOriginHandlersOf(ports);
    handlers.reopenInSSH();
    handlers.reopenInWSL();
    handlers.reopenInTunnel();
    deepStrictEqual(
      [calls, texts],
      [
        [],
        [
          "'Reopen in SSH' not possible in current context.",
          "'Reopen in WSL' not possible in current context.",
          "'Reopen in Tunnel' not possible in current context.",
        ],
      ],
    );
  });

  it('F-0406 AC-32: the refusal shows with a local origin and no folder open', () => {
    const {ports, texts} = windowOf(LOCAL, false);
    const handlers = reopenOriginHandlersOf(ports);
    handlers.reopenInSSH();
    handlers.reopenInWSL();
    handlers.reopenInTunnel();
    deepStrictEqual(texts, [
      "'Reopen in SSH' not possible in current context.",
      "'Reopen in WSL' not possible in current context.",
      "'Reopen in Tunnel' not possible in current context.",
    ]);
  });

  it('F-0406 AC-33: the in-remote commands do nothing in a window with no origin', () => {
    const {ports, calls, texts} = windowOf(undefined, true);
    const handlers = reopenOriginHandlersOf(ports);
    handlers.reopenInSSH();
    handlers.reopenInWSL();
    handlers.reopenInTunnel();
    deepStrictEqual([calls, texts], [[], []]);
  });
});
