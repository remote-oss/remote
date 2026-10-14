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

function resolvedAddress(resolution: ArchiveResolution): string {
  return resolution.kind === 'resolved' ? resolution.address : resolution.kind;
}

describe('resolveServerArchive', () => {
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

    it('takes the built-in table entry matched on applicationName', () => {
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

    it('reports a host the base-URL form has no archive for as unsupportedPlatform', () => {
      deepStrictEqual(
        resolveServerArchive(
          fixtureProfile('vscode-reduced'),
          {operatingSystem: 'darwin', architecture: 'arm64'},
          CONTAINERS_POLICY,
          {value: 'https://mirror.example.invalid/base', layer: 'profileUser'},
        ),
        {
          kind: 'invalidOverride',
          settingKey: 'remote.serverDownloadBaseUrl',
          problem: {
            kind: 'unsupportedPlatform',
            operatingSystem: 'darwin',
            architecture: 'arm64',
          },
        },
      );
    });

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
});
