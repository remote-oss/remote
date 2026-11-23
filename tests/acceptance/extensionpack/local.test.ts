/**
 * @fileoverview What a local window shows of the extension pack and its packed set (card #3039, F-9103): the pack declares
 * the UI kind and does nothing of its own, so no entry of the remote indicator menu and no activation in the extension
 * host log is the pack's, and every extension of the packed set is enabled. The packed set, the members and the WSL
 * condition are read from the manifests, never as literals.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {closeWindow, inWindow, variable, waitFor} from '../windows/harness.ts';
import {
  extensionPageOf,
  extensionsViewSections,
  quickPickRows,
} from '../windows/renderer.ts';
import {
  folderOf,
  installing,
  launcher,
  manifestOf,
  PACK_ID,
  REPOSITORY,
} from './pack-support.ts';
import type {Manifest} from './pack-support.ts';

/** The manifest fields these rows read. */
interface PackManifest extends Manifest {
  extensionKind?: string[];
  main?: string;
  contributes?: object;
  activationEvents?: string[];
}

/** The pack's manifest, and the ids of its members, of its members' own packs and of the whole packed set. */
const PACK = manifestOf('remote-extensionpack') as PackManifest;
const MEMBERS = PACK.extensionPack ?? [];
const OWN_PACKS = MEMBERS.flatMap(
  member => manifestOf(folderOf(member)).extensionPack ?? [],
);
const PACKED_SET = [PACK_ID, ...MEMBERS, ...OWN_PACKS];

/** The display name of the extension `identifier`, read from its manifest and its default strings. */
function displayNameOf(identifier: string): string {
  const folder = path.join(
    REPOSITORY,
    'packages',
    identifier === PACK_ID ? 'remote-extensionpack' : folderOf(identifier),
  );
  const shown = (
    JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8')) as {
      displayName?: string;
    }
  ).displayName;
  const key = /^%(.+)%$/.exec(shown ?? '')?.[1];
  return key === undefined
    ? (shown ?? identifier)
    : ((
        JSON.parse(
          readFileSync(path.join(folder, 'package.nls.json'), 'utf8'),
        ) as Record<string, string>
      )[key] ?? identifier);
}

/** The pack's display name. */
const PACK_NAME = displayNameOf(PACK_ID);

describe('the extension pack in a local window (card #3039, F-9103)', function () {
  this.timeout(300_000);

  let window = '';
  let installedHere: string[] = [];

  before(async () => {
    const profile = {
      extensions: variable('HARNESS_EXTENSIONS_FOLDER'),
      userData: variable('HARNESS_USER_DATA'),
      logs: path.join(variable('HARNESS_RUN_FOLDER'), 'extensionpack-local'),
    };
    const have = launcher(profile, ['--list-extensions']).stdout;
    installedHere = PACKED_SET.filter(identifier => !have.includes(identifier));
    launcher(profile, installing(installedHere));
    const folder = path.join(
      variable('HARNESS_RUN_FOLDER'),
      'extensionpack-local',
    );
    mkdirSync(folder, {recursive: true});
    window = await openFolderWindow(folder);
    await inWindow(window, 'workbench.view.extensions');
    await waitFor(
      'the Extensions view to list the pack',
      async () =>
        (await extensionsViewSections(window)).some(section =>
          section.entries.includes(PACK_NAME),
        ),
      30_000,
    );
  });

  after(async () => {
    try {
      await closeWindow(window);
    } finally {
      for (const identifier of installedHere) {
        launcher(
          {
            extensions: variable('HARNESS_EXTENSIONS_FOLDER'),
            userData: variable('HARNESS_USER_DATA'),
            logs: path.join(
              variable('HARNESS_RUN_FOLDER'),
              'extensionpack-local',
            ),
          },
          ['--uninstall-extension', identifier],
        );
      }
    }
  });

  /** The labels of the remote indicator menu of the window, which is closed again. */
  async function remoteMenu(): Promise<string[]> {
    void inWindow(window, 'workbench.action.remote.showMenu').catch(
      () => undefined,
    );
    await waitFor(
      'the remote indicator menu',
      async () => (await quickPickRows(window)).length > 0,
      30_000,
    );
    const labels = (await quickPickRows(window)).map(entry => entry.label);
    await inWindow(window, 'workbench.action.closeQuickOpen');
    return labels;
  }

  it('F-9103 AC-1 (c3039-kind): the pack’s manifest declares the UI kind and no other, and the installed copy does too', () => {
    const profile = {
      extensions: variable('HARNESS_EXTENSIONS_FOLDER'),
      userData: variable('HARNESS_USER_DATA'),
      logs: path.join(variable('HARNESS_RUN_FOLDER'), 'extensionpack-local'),
    };
    const folder = readdirSync(profile.extensions).find(entry =>
      entry.startsWith(`${PACK_ID}-`),
    );
    const installed = JSON.parse(
      readFileSync(
        path.join(profile.extensions, folder ?? 'missing', 'package.json'),
        'utf8',
      ),
    ) as PackManifest;
    deepStrictEqual(
      [PACK.extensionKind, installed.extensionKind],
      [['ui'], ['ui']],
    );
  });

  it('F-9103 AC-12 (c3039-enabled): in a local window every extension of the packed set is listed with the action that disables it, so it is enabled', async () => {
    const enabled: Array<[string, boolean]> = [];
    for (const identifier of PACKED_SET) {
      const name = displayNameOf(identifier);
      const page = await extensionPageOf(window, name);
      enabled.push([name, page.actions.includes('Disable this extension')]);
    }
    deepStrictEqual(
      enabled,
      PACKED_SET.map((identifier): [string, boolean] => [
        displayNameOf(identifier),
        true,
      ]),
    );
  });

  it('F-9103 AC-13, AC-25 (c3039-menu): the remote indicator menu lists no entry of the pack’s own, the pack having no contribution to give one, and the palette lists WSL commands only when the release lists WSL', async () => {
    const menu = await remoteMenu();
    void inWindow(window, 'workbench.action.showCommands', 'WSL:').catch(
      () => undefined,
    );
    await new Promise(resolve => setTimeout(resolve, 3000));
    const palette = (await quickPickRows(window)).map(entry => entry.label);
    await inWindow(window, 'workbench.action.closeQuickOpen');
    deepStrictEqual(
      {
        contributes: [PACK.main, PACK.contributes, PACK.activationEvents],
        menuNamesPack: menu.filter(label => label.includes(PACK_NAME)),
        menuNotEmpty: menu.length > 0,
        wslEntries:
          MEMBERS.includes('remote-oss.remote-wsl') ||
          !palette.some(label => label.startsWith('WSL:')),
      },
      {
        contributes: [undefined, undefined, undefined],
        menuNamesPack: [],
        menuNotEmpty: true,
        wslEntries: true,
      },
    );
  });

  it('F-9103 AC-14 (c3039-activation): the extension host log has no activation entry for the pack, though it has one for a member', () => {
    const logs = variable('HARNESS_EDITOR_LOGS');
    const lines = readdirSync(logs, {recursive: true})
      .map(String)
      .filter(entry => entry.endsWith('exthost.log'))
      .flatMap(entry =>
        readFileSync(path.join(logs, entry), 'utf8')
          .split('\n')
          .filter(line => line.includes('_doActivateExtension')),
      );
    deepStrictEqual(
      {
        member: lines.some(line =>
          MEMBERS.some(member => line.includes(` ${member},`)),
        ),
        pack: lines.filter(line => line.includes(` ${PACK_ID},`)),
      },
      {member: true, pack: []},
    );
  });
});
