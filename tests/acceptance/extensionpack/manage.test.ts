/**
 * @fileoverview What the editor does with the extension pack's manifest when the pack or one of its members is
 * uninstalled, through the editor's command-line launcher on profiles of their own (card #3037, F-9102): the cascade is
 * core's own handling of the manifest's `extensionPack`, so the rows check that the pack's manifest, as built, makes core
 * do it. The members are read from the manifests of the packages, so the rows follow the pack's member list.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  folderOf,
  installedIn,
  installing,
  launcher,
  type Manifest,
  manifestOf,
  namedAfterPack,
  PACK_ID,
  PACK_VERSION,
  type Profile,
  profileOf,
} from './pack-support.ts';

/** The identifiers the pack names. */
const MEMBERS = manifestOf('remote-extensionpack').extensionPack ?? [];

/** The identifiers a member names in its own pack, in the order of the members. */
function ownPackOf(member: string): string[] {
  return manifestOf(folderOf(member)).extensionPack ?? [];
}

/** A member that has a pack of its own, which the rows uninstall and install on its own. */
const SSH_MEMBER = 'remote-oss.remote-ssh';

/** Every identifier of the pack's profile: the members' own pack members, the members and the pack, in the order they install in. */
const FAMILY = [...MEMBERS.flatMap(ownPackOf), ...MEMBERS, PACK_ID];

/** The identifiers of the extensions a profile lists, sorted. */
function listed(profile: Profile): string[] {
  return launcher(profile, ['--list-extensions']).stdout.toSorted();
}

/** What the launcher says of uninstalling `identifier`: its status and its lines. */
function uninstalled(profile: Profile, identifier: string) {
  const result = launcher(profile, ['--uninstall-extension', identifier]);
  return {status: result.status, lines: result.stdout};
}

/** The paths below `folder` named after the pack, none when the editor made no such folder. */
function namedAfterPackIn(folder: string): string[] {
  return existsSync(folder) ? namedAfterPack(folder) : [];
}

/** The lines the launcher gives for a successful uninstall of `identifier`. */
function uninstallLines(identifier: string): string[] {
  return [
    `Uninstalling ${identifier}...`,
    `Extension '${identifier}' was successfully uninstalled!`,
  ];
}

describe('uninstalling the extension pack and its members through the command line (card #3037, F-9102)', function () {
  this.timeout(300_000);

  it('F-9102 AC-17 (c3037-cli-pack): with no window, uninstalling the pack through the command line prints the uninstalling and the uninstalled lines for the pack, exits 0, and the profile lists none of the pack, its members and their own pack members afterwards', () => {
    const profile = profileOf('manage-pack-cli');
    launcher(profile, installing(FAMILY));
    const present = listed(profile);
    const removal = uninstalled(profile, PACK_ID);
    deepStrictEqual(
      {present, removal, after: listed(profile)},
      {
        present: FAMILY.toSorted(),
        removal: {status: 0, lines: uninstallLines(PACK_ID)},
        after: [],
      },
    );
  });

  it('F-9102 AC-3 (c3037-pack-gone): after the pack is uninstalled the profile lists none of the pack, its members and their own pack members, and a second start of the launcher lists them no more and reinstalls nothing', () => {
    const profile = profileOf('manage-pack-gone');
    launcher(profile, installing(FAMILY));
    uninstalled(profile, PACK_ID);
    const first = listed(profile);
    const second = listed(profile);
    deepStrictEqual(
      {first, second, folders: installedIn(profile).length},
      {first: [], second: [], folders: FAMILY.length},
    );
  });

  it('F-9102 AC-26 (c3037-no-dependencies): the pack’s manifest as installed names its members in `extensionPack` and declares no `extensionDependencies`', () => {
    const profile = profileOf('manage-manifest');
    launcher(profile, installing(FAMILY));
    const folder = installedIn(profile).find(entry =>
      entry.startsWith(`${PACK_ID}-`),
    );
    const installedManifest = JSON.parse(
      readFileSync(
        path.join(profile.extensions, folder ?? 'missing', 'package.json'),
        'utf8',
      ),
    ) as Manifest;
    deepStrictEqual(
      [
        installedManifest.extensionPack,
        installedManifest.extensionDependencies,
      ],
      [MEMBERS, undefined],
    );
  });

  it('F-9102 AC-5 (c3037-member-first): a member installed on its own before the pack is uninstalled with the pack, with its own pack members', () => {
    const profile = profileOf('manage-member-first');
    const first = [...ownPackOf(SSH_MEMBER), SSH_MEMBER];
    const before = launcher(profile, installing(first));
    const withPack = launcher(profile, installing([PACK_ID]));
    const present = listed(profile);
    const removal = uninstalled(profile, PACK_ID);
    deepStrictEqual(
      {
        installed: [before.status, withPack.status],
        present,
        removal,
        after: listed(profile),
      },
      {
        installed: [0, 0],
        present: [...first, PACK_ID].toSorted(),
        removal: {status: 0, lines: uninstallLines(PACK_ID)},
        after: [],
      },
    );
  });

  it('F-9102 AC-18 (c3037-member-cli): uninstalling one member through the command line removes that member and its own pack members, and the pack and the other members stay', () => {
    const profile = profileOf('manage-member-cli');
    launcher(profile, installing(FAMILY));
    const removal = uninstalled(profile, SSH_MEMBER);
    const gone = new Set([SSH_MEMBER, ...ownPackOf(SSH_MEMBER)]);
    deepStrictEqual(
      {removal, after: listed(profile)},
      {
        removal: {status: 0, lines: uninstallLines(SSH_MEMBER)},
        after: FAMILY.filter(identifier => !gone.has(identifier)).toSorted(),
      },
    );
  });

  it('F-9102 AC-25 (c3037-names): after installing the pack and its members and uninstalling the pack, no file or folder named after the pack is in the profile’s user data or logs, and its installed folder alone is in the extensions folder', () => {
    const profile = profileOf('manage-names');
    launcher(profile, installing(FAMILY));
    uninstalled(profile, PACK_ID);
    deepStrictEqual(
      {
        userData: namedAfterPackIn(profile.userData),
        logs: namedAfterPackIn(profile.logs),
        extensions: namedAfterPack(profile.extensions)
          .filter(entry => !entry.includes(path.sep))
          .filter(entry => entry.toLowerCase().startsWith(PACK_ID)),
      },
      {
        userData: [],
        logs: [],
        extensions: [`${PACK_ID}-${PACK_VERSION}`],
      },
    );
  });
});
