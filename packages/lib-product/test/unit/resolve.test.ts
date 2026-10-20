import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  type ArchiveResolution,
  OVERRIDE_POLICIES,
  type OverridePolicy,
  readProfile,
  resolveServerArchive,
} from '../../src/index.ts';
import {fixtureProfile} from './fixture.ts';

function policyOf(
  extension: 'remote-ssh' | 'remote-containers',
): OverridePolicy {
  const policy = OVERRIDE_POLICIES[extension];
  if (policy === undefined) {
    throw new Error(`no policy for ${extension}`);
  }
  return policy;
}

const SSH_POLICY = policyOf('remote-ssh');
const CONTAINERS_POLICY = policyOf('remote-containers');
const LINUX_X64 = {operatingSystem: 'linux', architecture: 'x64'};

const GITHUB_RULE = {
  kind: 'hosts',
  hosts: [
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
  ],
};

function redirectOf(resolution: ArchiveResolution): unknown {
  return resolution.kind === 'resolved' ? resolution.redirect : resolution.kind;
}

function resolvedAddress(resolution: ArchiveResolution): string {
  return resolution.kind === 'resolved' ? resolution.address : resolution.kind;
}

describe('resolveServerArchive', () => {
  describe('the redirect rule (card server-22)', () => {
    const OVERRIDE = {layer: 'defaultProfileUser'} as const;

    it('an override gives any host, in the base-URL form and the template form', () => {
      const profile = fixtureProfile('vscodium-reduced');
      deepStrictEqual(
        [
          'https://archives.example.invalid',
          'https://archives.example.invalid/${os}-${arch}.tar.gz',
        ].map(value =>
          redirectOf(
            resolveServerArchive(profile, LINUX_X64, CONTAINERS_POLICY, {
              ...OVERRIDE,
              value,
            }),
          ),
        ),
        [{kind: 'any'}, {kind: 'any'}],
      );
    });

    it("a product template gives its host, the product's listed hosts lower-cased without repeats, and the table's", () => {
      deepStrictEqual(
        redirectOf(
          resolveServerArchive(
            fixtureProfile('synthetic', {
              serverDownloadUrlTemplate:
                'https://dl.example.com/${commit}/server-${os}-${arch}.tar.gz',
              serverDownloadRedirectHosts: [
                'cdn.example.com',
                'CDN.Example.com',
              ],
            }),
            LINUX_X64,
            SSH_POLICY,
          ),
        ),
        {kind: 'hosts', hosts: ['dl.example.com', 'cdn.example.com']},
      );
    });

    it('a product template on github.com with no list gives github.com and the two table hosts', () => {
      deepStrictEqual(
        redirectOf(
          resolveServerArchive(
            fixtureProfile('vscodium-reduced'),
            LINUX_X64,
            SSH_POLICY,
          ),
        ),
        GITHUB_RULE,
      );
    });

    it("a built-in table source ignores the profile's list", () => {
      deepStrictEqual(
        redirectOf(
          resolveServerArchive(
            fixtureProfile('vscodium-reduced', {
              serverDownloadUrlTemplate: '',
              serverDownloadRedirectHosts: ['cdn.example.com'],
            }),
            LINUX_X64,
            SSH_POLICY,
          ),
        ),
        GITHUB_RULE,
      );
    });
  });

  describe('resolution order (F-3902 rule 1, F-1402 rule 4)', () => {
    it('takes the override first', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscodium-reduced'),
          LINUX_X64,
          SSH_POLICY,
          {
            value: 'https://archives.example.invalid/${os}-${arch}.tar.gz',
            layer: 'defaultProfileUser',
          },
        ),
        {
          kind: 'resolved',
          address: 'https://archives.example.invalid/linux-x64.tar.gz',
          step: 'override',
          redirect: {kind: 'any'},
          urlHost: 'archives.example.invalid',
          serverLicenseEmpty: true,
          skipped: [],
        },
      );
    });

    it("takes the product's own template before the built-in table", () => {
      deepStrictEqual(
        resolvedAddress(
          resolveServerArchive(
            fixtureProfile('vscodium-reduced'),
            LINUX_X64,
            SSH_POLICY,
          ),
        ),
        'https://github.com/VSCodium/vscodium/releases/download/1.135.06055/vscodium-reh-linux-x64-1.135.06055.tar.gz',
      );
    });

    it('F-0503 AC-27 (f1402-rule-4): with no override the built-in table entry matched on applicationName gives the address', () => {
      deepStrictEqual(
        resolvedAddress(
          resolveServerArchive(
            fixtureProfile('vscodium-reduced', {serverDownloadUrlTemplate: ''}),
            {operatingSystem: 'alpine', architecture: 'arm64'},
            SSH_POLICY,
          ),
        ),
        'https://github.com/VSCodium/vscodium/releases/download/1.135.06055/vscodium-reh-alpine-arm64-1.135.06055.tar.gz',
      );
    });

    it('F-3902 AC-2: a VSCodium product.json without the template takes the built-in codium entry, which names the archive of its own template', () => {
      const fields = JSON.parse(
        readFileSync(
          path.join(
            import.meta.dirname,
            '..',
            'fixtures',
            'vscodium-reduced.json',
          ),
          'utf8',
        ),
      ) as Record<string, unknown>;
      delete fields.serverDownloadUrlTemplate;
      const reading = readProfile(JSON.stringify(fields));
      if (reading.kind !== 'profile') {
        throw new Error(`the fixture is unreadable: ${reading.reason}`);
      }
      const removed = resolveServerArchive(
        reading.profile,
        LINUX_X64,
        SSH_POLICY,
      );
      const own = resolveServerArchive(
        fixtureProfile('vscodium-reduced'),
        LINUX_X64,
        SSH_POLICY,
      );
      deepStrictEqual(
        [
          removed.kind === 'resolved' ? removed.step : removed.kind,
          resolvedAddress(removed),
        ],
        ['builtInTable', resolvedAddress(own)],
      );
    });

    it('F-3902 AC-4: an override with the six placeholders names alpine, arm64, the version, the commit, the quality and an empty release', () => {
      deepStrictEqual(
        resolvedAddress(
          resolveServerArchive(
            fixtureProfile('vscodium-reduced'),
            {operatingSystem: 'alpine', architecture: 'arm64'},
            SSH_POLICY,
            {
              value:
                'http://downloads.example.invalid/x?os=${os}&arch=${arch}&version=${version}&commit=${commit}&quality=${quality}&release=${release}',
              layer: 'defaultProfileUser',
            },
          ),
        ),
        'http://downloads.example.invalid/x?os=alpine&arch=arm64&version=1.135.06055&commit=1a46a584&quality=stable&release=',
      );
    });

    it('gives the insiders entry its own repository', () => {
      deepStrictEqual(
        resolvedAddress(
          resolveServerArchive(
            fixtureProfile('vscodium-reduced', {
              applicationName: 'codium-insiders',
              serverDownloadUrlTemplate: '',
              version: '1.135.06030-insider',
            }),
            LINUX_X64,
            CONTAINERS_POLICY,
          ),
        ),
        'https://github.com/VSCodium/vscodium-insiders/releases/download/1.135.06030-insider/vscodium-reh-linux-x64-1.135.06030-insider.tar.gz',
      );
    });

    it('has no entry for VS Code: no source without an override (F-3902.AC-8)', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscode-reduced'),
          LINUX_X64,
          SSH_POLICY,
        ),
        {
          kind: 'noSource',
          applicationName: 'code',
          settingKey: 'remote.SSH.serverDownloadUrlTemplate',
          skipped: [],
        },
      );
    });

    it('has no entry for VS Code Insiders either', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscode-reduced', {applicationName: 'code-insiders'}),
          LINUX_X64,
          CONTAINERS_POLICY,
        ).kind,
        'noSource',
      );
    });
  });

  describe('override layers', () => {
    it('ignores a remote-ssh value from the workspace (F-3902.AC-17)', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscode-reduced'),
          LINUX_X64,
          SSH_POLICY,
          {
            value: 'https://archives.example.invalid/server.tar.gz',
            layer: 'workspace',
          },
        ).kind,
        'noSource',
      );
    });

    it('ignores a remote-ssh value from a non-default profile', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscode-reduced'),
          LINUX_X64,
          SSH_POLICY,
          {
            value: 'https://archives.example.invalid/server.tar.gz',
            layer: 'profileUser',
          },
        ).kind,
        'noSource',
      );
    });

    it('takes a remote-containers value from any layer', () => {
      deepStrictEqual(
        resolvedAddress(
          resolveServerArchive(
            fixtureProfile('vscode-reduced'),
            LINUX_X64,
            CONTAINERS_POLICY,
            {
              value: 'https://archives.example.invalid/${os}.tar.gz',
              layer: 'workspaceFolder',
            },
          ),
        ),
        'https://archives.example.invalid/linux.tar.gz',
      );
    });

    it('counts an empty value in an allowed layer as set, and unusable', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscodium-reduced'),
          LINUX_X64,
          SSH_POLICY,
          {
            value: '',
            layer: 'defaultProfileUser',
          },
        ),
        {
          kind: 'invalidOverride',
          settingKey: 'remote.SSH.serverDownloadUrlTemplate',
          problem: {kind: 'notHttpUrl', value: ''},
        },
      );
    });
  });

  describe('unusable templates (F-3902 rule 3)', () => {
    it('reports an unknown placeholder in the override as invalidOverride with its name', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscode-reduced'),
          LINUX_X64,
          SSH_POLICY,
          {
            value: 'https://archives.example.invalid/${platform}.tar.gz',
            layer: 'defaultProfileUser',
          },
        ),
        {
          kind: 'invalidOverride',
          settingKey: 'remote.SSH.serverDownloadUrlTemplate',
          problem: {kind: 'unknownPlaceholder', name: 'platform'},
        },
      );
    });

    it('skips a product template with an unknown placeholder and falls through', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscodium-reduced', {
            serverDownloadUrlTemplate:
              'https://archives.example.invalid/${platform}',
          }),
          LINUX_X64,
          SSH_POLICY,
        ),
        {
          kind: 'resolved',
          address:
            'https://github.com/VSCodium/vscodium/releases/download/1.135.06055/vscodium-reh-linux-x64-1.135.06055.tar.gz',
          step: 'builtInTable',
          redirect: GITHUB_RULE,
          urlHost: 'github.com',
          serverLicenseEmpty: true,
          skipped: [
            {
              step: 'productTemplate',
              problem: {kind: 'unknownPlaceholder', name: 'platform'},
            },
          ],
        },
      );
    });

    it('skips a product template that is not an http URL and reports no source', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('synthetic', {
            serverDownloadUrlTemplate: 'file:///server-${os}',
          }),
          LINUX_X64,
          SSH_POLICY,
        ),
        {
          kind: 'noSource',
          applicationName: 'fixture-editor',
          settingKey: 'remote.SSH.serverDownloadUrlTemplate',
          skipped: [
            {
              step: 'productTemplate',
              problem: {kind: 'notHttpUrl', value: 'file:///server-linux'},
            },
          ],
        },
      );
    });

    it('applies the policy placeholders to the product template too', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('synthetic', {
            serverDownloadUrlTemplate:
              'https://archives.example.invalid/${applicationName}',
          }),
          LINUX_X64,
          CONTAINERS_POLICY,
        ).kind,
        'noSource',
      );
    });
  });

  describe('base-URL form (F-1402)', () => {
    const cases: Array<[string, string, string]> = [
      ['linux', 'x64', 'linux-x64'],
      ['linux', 'arm64', 'linux-arm64'],
      ['linux', 'armhf', 'linux-armhf'],
      ['alpine', 'x64', 'linux-alpine'],
      ['alpine', 'arm64', 'alpine-arm64'],
      ['linux', 'ppc64le', 'linux-ppc64le'],
      ['linux', 'riscv64', 'linux-riscv64'],
      ['linux', 'loong64', 'linux-loong64'],
      ['linux', 's390x', 'linux-s390x'],
      ['darwin', 'arm64', 'darwin-arm64'],
    ];
    for (const [operatingSystem, architecture, platform] of cases) {
      it(`appends the archive path with server-${platform} for ${operatingSystem}/${architecture}`, () => {
        deepStrictEqual(
          resolvedAddress(
            resolveServerArchive(
              fixtureProfile('vscode-reduced'),
              {operatingSystem, architecture},
              CONTAINERS_POLICY,
              {
                value: 'https://mirror.example.invalid/base/',
                layer: 'profileUser',
              },
            ),
          ),
          `https://mirror.example.invalid/base/commit:04c0d99f/server-${platform}/stable`,
        );
      });
    }

    it('uses a remote-ssh value without placeholders as one URL, never a base', () => {
      deepStrictEqual(
        resolvedAddress(
          resolveServerArchive(
            fixtureProfile('vscode-reduced'),
            LINUX_X64,
            SSH_POLICY,
            {
              value: 'https://mirror.example.invalid/server.tar.gz',
              layer: 'defaultProfileUser',
            },
          ),
        ),
        'https://mirror.example.invalid/server.tar.gz',
      );
    });
  });

  describe('synthetic product (ADR-0006 decision 6)', () => {
    it('resolves from its own template with every placeholder', () => {
      deepStrictEqual(
        resolvedAddress(
          resolveServerArchive(
            fixtureProfile('synthetic'),
            LINUX_X64,
            SSH_POLICY,
          ),
        ),
        'https://archives.example.invalid/fixture-quality/f1f2f3f4/9.8.7-r7/server-linux-x64.tar.gz',
      );
    });

    it('names no product of the table in any result', () => {
      deepStrictEqual(
        /codium|visualstudio|vscode/i.test(
          JSON.stringify(
            resolveServerArchive(
              fixtureProfile('synthetic', {serverLicense: ['terms']}),
              LINUX_X64,
              CONTAINERS_POLICY,
            ),
          ),
        ),
        false,
      );
    });
  });

  describe('the containers source order (card containers-05)', () => {
    const LAYERS = [
      'defaultProfileUser',
      'profileUser',
      'remote',
      'workspace',
      'workspaceFolder',
    ] as const;

    for (const layer of LAYERS) {
      it(`F-0503 AC-35: a base URL from the ${layer} layer is the override, with the commit, platform and quality appended`, () => {
        const resolution = resolveServerArchive(
          fixtureProfile('vscodium-reduced'),
          LINUX_X64,
          CONTAINERS_POLICY,
          {value: 'https://mirror.test/base', layer},
        );
        deepStrictEqual(
          resolution.kind === 'resolved'
            ? [resolution.step, resolution.address]
            : resolution.kind,
          [
            'override',
            'https://mirror.test/base/commit:1a46a584/server-linux-x64/stable',
          ],
        );
      });
    }

    it("F-0503 AC-53: without an override the product's template is used and the built-in table is not consulted", () => {
      const resolution = resolveServerArchive(
        fixtureProfile('vscodium-reduced'),
        LINUX_X64,
        CONTAINERS_POLICY,
      );
      deepStrictEqual(
        resolution.kind === 'resolved'
          ? [resolution.step, resolution.address]
          : resolution.kind,
        [
          'productTemplate',
          'https://github.com/VSCodium/vscodium/releases/download/1.135.06055/vscodium-reh-linux-x64-1.135.06055.tar.gz',
        ],
      );
    });

    for (const [applicationName, repository] of [
      ['codium', 'vscodium'],
      ['codium-insiders', 'vscodium-insiders'],
    ] as const) {
      it(`F-0503 AC-36: ${applicationName} with no template resolves from the built-in table of ${repository}`, () => {
        const resolution = resolveServerArchive(
          fixtureProfile('vscodium-reduced', {
            applicationName,
            serverDownloadUrlTemplate: '',
          }),
          LINUX_X64,
          CONTAINERS_POLICY,
        );
        deepStrictEqual(
          resolution.kind === 'resolved'
            ? [
                resolution.step,
                resolution.address.startsWith(
                  `https://github.com/VSCodium/${repository}/releases/download/`,
                ),
              ]
            : resolution.kind,
          ['builtInTable', true],
        );
      });
    }

    it('F-0503 AC-37: code with no override and no template has no source and names the setting', () => {
      const resolution = resolveServerArchive(
        fixtureProfile('vscode-reduced'),
        LINUX_X64,
        CONTAINERS_POLICY,
      );
      deepStrictEqual(
        resolution.kind === 'noSource'
          ? resolution.settingKey
          : resolution.kind,
        'remote.serverDownloadBaseUrl',
      );
    });
  });
});
