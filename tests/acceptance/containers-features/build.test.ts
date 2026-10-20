import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  containersLog,
  containersLogSince,
  variable,
} from '../windows/harness.ts';
import {
  environmentOf,
  featureBuilds,
  lockfileOf,
  metadataOf,
  runFeature,
  wasInstalled,
  writeLocalFeature,
} from './features-support.ts';

const execFileAsync = promisify(execFile);

/** The local image AC-16 builds, whose `devcontainer.metadata` label is the base image's entry. */
const BASE_IMAGE = 'remote-oss-run-c93-base-metadata';

/** The ids of the Feature entries of the metadata, in order. */
function idsOf(entries: ReadonlyArray<Record<string, unknown>>): unknown[] {
  return entries
    .filter(entry => typeof entry.id === 'string')
    .map(entry => entry.id);
}

describe('a build with Features (card containers-93)', function () {
  this.timeout(1_800_000);
  const {build} = featureBuilds();

  it('F-0414 AC-1 (oci-and-local): a registry Feature and a local one both leave their effects in the container', async () => {
    const built = await build(
      'c93-ac1',
      {features: {[runFeature('lab-plain')]: {}, './local-a': {}}},
      folder => {
        writeLocalFeature(folder, 'local-a');
      },
    );
    deepStrictEqual(
      [
        Object.keys(await environmentOf(built.containerId, 'lab-plain'))
          .length > 0,
        Object.keys(await environmentOf(built.containerId, 'local-a')).length >
          0,
      ],
      [true, true],
    );
  });

  it('F-0414 AC-2 (lockfile): the lockfile holds one entry, for the registry Feature, with its version, digest and integrity, and none for the local one', async () => {
    const built = await build(
      'c93-ac2',
      {features: {[runFeature('lab-plain')]: {}, './local-a': {}}},
      folder => {
        writeLocalFeature(folder, 'local-a');
      },
    );
    const reference = runFeature('lab-plain');
    const entries = Object.entries(lockfileOf(built.folder)?.features ?? {});
    deepStrictEqual(
      entries.map(([key, entry]) => {
        const digest = String(entry.resolved).split('@sha256:')[1] ?? '';
        return [
          key,
          Object.keys(entry).sort(),
          String(entry.resolved) ===
            `${reference.slice(0, -2)}@sha256:${digest}`,
          entry.integrity === `sha256:${digest}`,
        ];
      }),
      [[reference, ['integrity', 'resolved', 'version'], true, true]],
    );
  });

  it('F-0414 AC-4 (no-features): a build with no Features writes no lockfile', async () => {
    const built = await build('c93-ac4', {});
    deepStrictEqual(lockfileOf(built.folder), undefined);
  });

  it('F-0414 AC-16 (metadata-order): the metadata holds the base image’s entry first, then one entry per installed Feature, a hard dependency included, in install order', async () => {
    const context = mkdtempSync(path.join(tmpdir(), 'c93-base-'));
    writeFileSync(
      path.join(context, 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nLABEL devcontainer.metadata='[{"containerEnv":{"C93_BASE":"base"}}]'\n`,
    );
    await execFileAsync('docker', ['build', '--tag', BASE_IMAGE, context]);
    try {
      const built = await build(
        'c93-ac16',
        {
          image: BASE_IMAGE,
          features: {
            './beta': {},
            './alpha': {},
            [runFeature('lab-depends-a')]: {},
          },
        },
        folder => {
          writeLocalFeature(folder, 'alpha');
          writeLocalFeature(folder, 'beta');
        },
      );
      const entries = await metadataOf(built.containerId);
      deepStrictEqual(
        [
          (entries[0]?.containerEnv as Record<string, string> | undefined)
            ?.C93_BASE,
          idsOf(entries),
        ],
        [
          'base',
          [
            './alpha',
            './beta',
            runFeature('lab-depends-e'),
            runFeature('lab-depends-a'),
          ],
        ],
      );
    } finally {
      rmSync(context, {recursive: true});
    }
  });

  it('F-0414 AC-44 (local-order): local Features declared ./beta then ./alpha are installed ./alpha first', async () => {
    const built = await build(
      'c93-ac44',
      {features: {'./beta': {}, './alpha': {}}},
      folder => {
        writeLocalFeature(folder, 'alpha');
        writeLocalFeature(folder, 'beta');
      },
    );
    deepStrictEqual(idsOf(await metadataOf(built.containerId)), [
      './alpha',
      './beta',
    ]);
  });

  it('F-0414 AC-3 (lockfile-off): with dev.containers.lockfile false an OCI Feature’s build neither writes a lockfile nor changes the one that is there', async () => {
    await setUserSetting('dev.containers.lockfile', false);
    try {
      const fresh = await build('c93-ac3', {
        features: {[runFeature('lab-plain')]: {}},
      });
      const kept = await build(
        'c93-ac3-kept',
        {features: {[runFeature('lab-plain')]: {}}},
        folder => {
          writeFileSync(
            path.join(folder, '.devcontainer', 'devcontainer-lock.json'),
            '{"features":{}}',
          );
        },
      );
      deepStrictEqual(
        [lockfileOf(fresh.folder), lockfileOf(kept.folder)],
        [undefined, {features: {}}],
      );
    } finally {
      await setUserSetting('dev.containers.lockfile', undefined);
    }
  });

  it('F-0414 AC-5 (default-features): a Feature only dev.containers.defaultFeatures names is installed, and the lockfile’s features object is empty', async () => {
    await setUserSetting('dev.containers.defaultFeatures', {
      [runFeature('lab-plain')]: {},
    });
    try {
      const built = await build('c93-ac5', {});
      deepStrictEqual(
        [
          Object.keys(await environmentOf(built.containerId, 'lab-plain'))
            .length > 0,
          lockfileOf(built.folder),
        ],
        [true, {features: {}}],
      );
    } finally {
      await setUserSetting('dev.containers.defaultFeatures', undefined);
    }
  });

  it('F-0414 AC-6 (override-order): overrideFeatureInstallOrder puts the Feature that would come second first', async () => {
    const built = await build(
      'c93-ac6',
      {
        features: {'./alpha': {}, './beta': {}},
        overrideFeatureInstallOrder: ['./beta'],
      },
      folder => {
        writeLocalFeature(folder, 'alpha');
        writeLocalFeature(folder, 'beta');
      },
    );
    deepStrictEqual(idsOf(await metadataOf(built.containerId)), [
      './beta',
      './alpha',
    ]);
  });

  it('F-0414 AC-7 (installs-after): installsAfter naming a Feature that was not requested installs nothing and puts nothing in the metadata', async () => {
    const built = await build(
      'c93-ac7',
      {features: {'./gamma': {}}},
      folder => {
        writeLocalFeature(folder, 'gamma', {
          metadata: {installsAfter: [runFeature('lab-plain').slice(0, -2)]},
        });
      },
    );
    deepStrictEqual(
      [
        idsOf(await metadataOf(built.containerId)),
        await wasInstalled(built.containerId, 'lab-plain'),
      ],
      [['./gamma'], false],
    );
  });

  it('F-0414 AC-25 (same-id): features and defaultFeatures naming one id install it once, with the options of features', async () => {
    await setUserSetting('dev.containers.defaultFeatures', {
      [runFeature('lab-options')]: {level: 'low', tone: 'loud'},
    });
    try {
      const built = await build('c93-ac25', {
        features: {[runFeature('lab-options')]: {level: 'high'}},
      });
      const environment = await environmentOf(built.containerId, 'lab-options');
      deepStrictEqual(
        [environment.LEVEL, idsOf(await metadataOf(built.containerId)).length],
        ['high', 1],
      );
    } finally {
      await setUserSetting('dev.containers.defaultFeatures', undefined);
    }
  });

  it('F-0414 AC-27 (depends-on): a Feature that depends on another installs it first, and the lockfile has both with the dependency in dependsOn', async () => {
    const built = await build('c93-ac27', {
      features: {[runFeature('lab-depends-a')]: {}},
    });
    const lock = lockfileOf(built.folder)?.features ?? {};
    deepStrictEqual(
      [
        idsOf(await metadataOf(built.containerId)),
        Object.keys(lock).sort(),
        lock[runFeature('lab-depends-a')]?.dependsOn,
      ],
      [
        [runFeature('lab-depends-e'), runFeature('lab-depends-a')],
        [runFeature('lab-depends-a'), runFeature('lab-depends-e')].sort(),
        [runFeature('lab-depends-e')],
      ],
    );
  });

  it('F-0414 AC-33 (option-names): an option id is turned into the variable name the script sees, set or not', async () => {
    const built = await build(
      'c93-ac33',
      {features: {'./opts': {'2nd-Option!Name': 'given-value'}}},
      folder => {
        writeLocalFeature(folder, 'opts', {
          metadata: {
            options: {
              '2nd-Option!Name': {type: 'string', default: 'x'},
              unsetOption: {type: 'string', default: 'fallback-value'},
            },
          },
        });
      },
    );
    const environment = await environmentOf(built.containerId, 'opts');
    deepStrictEqual(
      [environment._ND_OPTION_NAME, environment.UNSETOPTION],
      ['given-value', 'fallback-value'],
    );
  });

  it('F-0414 AC-34 (string-value): a Feature whose value is a plain string sees it as VERSION when it declares that option', async () => {
    const built = await build(
      'c93-ac34',
      {features: {'./plain': 'some-text'}},
      folder => {
        writeLocalFeature(folder, 'plain', {
          metadata: {options: {version: {type: 'string', default: 'latest'}}},
        });
      },
    );
    deepStrictEqual(
      (await environmentOf(built.containerId, 'plain')).VERSION,
      'some-text',
    );
  });

  it('F-0414 AC-40 (override-unrequested): an overrideFeatureInstallOrder entry that was not requested is ignored without a message and the others are put first', async () => {
    const mark = containersLog().length;
    const built = await build(
      'c93-ac40',
      {
        features: {'./alpha': {}, './beta': {}},
        overrideFeatureInstallOrder: ['./nope', './beta'],
      },
      folder => {
        writeLocalFeature(folder, 'alpha');
        writeLocalFeature(folder, 'beta');
      },
    );
    deepStrictEqual(
      [
        idsOf(await metadataOf(built.containerId)),
        containersLogSince(mark).filter(line => line.includes('./nope')),
      ],
      [['./beta', './alpha'], []],
    );
  });

  it('F-0414 AC-45 (as-root): a local Feature’s script runs as root on a configuration with another remote user, and sees both users', async () => {
    const built = await build(
      'c93-ac45',
      {features: {'./who': {}}, remoteUser: 'worker'},
      folder => {
        writeLocalFeature(folder, 'who', {
          script:
            'adduser -D -s /bin/sh worker\nid -u > /usr/local/share/remote-oss-run/who.uid',
        });
      },
    );
    const environment = await environmentOf(built.containerId, 'who');
    const {stdout} = await execFileAsync('docker', [
      'exec',
      built.containerId,
      'cat',
      '/usr/local/share/remote-oss-run/who.uid',
    ]);
    deepStrictEqual(
      [stdout.trim(), environment._REMOTE_USER, environment._CONTAINER_USER],
      ['0', 'worker', 'root'],
    );
  });
});
