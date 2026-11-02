import {deepStrictEqual} from 'node:assert';
import {EDITOR_ENGINE} from './editor-floor.ts';
import {
  BUNDLED_DEPENDENCY_FOLDERS,
  SHIPPED_EXTENSION_IDS,
  vsixProblems,
} from './vsix-rules.ts';

describe('vsix-rules', () => {
  const manifest = {
    name: 'remote-ssh',
    publisher: 'remote-oss',
    license: 'MIT',
    engines: {vscode: EDITOR_ENGINE},
  };
  const files = ['package.json', 'LICENSE', 'dist/extension.js'];

  it('tooling-95: the shipped manifest and file list have no problems', () => {
    deepStrictEqual(vsixProblems('remote-ssh', manifest, files), []);
  });

  it('tooling-95: a missing LICENSE is a problem, and one in a subfolder is not at the root', () => {
    deepStrictEqual(
      [
        vsixProblems('remote-ssh', manifest, [
          'package.json',
          'dist/extension.js',
        ]),
        vsixProblems('remote-ssh', manifest, [
          'package.json',
          'resources/LICENSE',
        ]),
      ],
      [
        [
          'packages/remote-ssh: no LICENSE, LICENSE.md or LICENSE.txt at the package root',
        ],
        [
          'packages/remote-ssh: no LICENSE, LICENSE.md or LICENSE.txt at the package root',
        ],
      ],
    );
  });

  it('tooling-95: a license other than MIT, or no license, is a problem', () => {
    deepStrictEqual(
      [
        vsixProblems(
          'remote-ssh',
          {
            ...manifest,
            license: 'Apache-2.0',
          },
          files,
        ),
        vsixProblems(
          'remote-ssh',
          {
            name: 'remote-ssh',
            publisher: 'remote-oss',
            engines: {vscode: EDITOR_ENGINE},
          },
          files,
        ),
      ],
      [
        ['packages/remote-ssh: the license is not MIT'],
        ['packages/remote-ssh: the license is not MIT'],
      ],
    );
  });

  it('tooling-95: a Microsoft notices file is a problem by name, and .rtf anywhere', () => {
    deepStrictEqual(
      [
        vsixProblems('remote-ssh', manifest, [
          ...files,
          'ThirdPartyNotices.txt',
        ]),
        vsixProblems('remote-ssh', manifest, [
          'package.json',
          'LICENSE',
          'docs/eula-notes.rtf',
          'notes/third-party.txt',
        ]),
        vsixProblems('remote-ssh', manifest, [
          ...files,
          'resources/LICENSE-Microsoft.txt',
          'notes/eula',
        ]),
      ],
      [
        ['packages/remote-ssh: the VSIX holds ThirdPartyNotices.txt'],
        ['packages/remote-ssh: the VSIX holds docs/eula-notes.rtf'],
        [
          'packages/remote-ssh: the VSIX holds resources/LICENSE-Microsoft.txt',
          'packages/remote-ssh: the VSIX holds notes/eula',
        ],
      ],
    );
  });

  it('tooling-95: the bundled dependency folder is the one named for ADR-0005', () => {
    deepStrictEqual(BUNDLED_DEPENDENCY_FOLDERS, ['dist/devcontainers-cli/']);
  });

  it('tooling-95: a licence or notices file under a bundled dependency folder passes', () => {
    deepStrictEqual(
      [
        vsixProblems(
          'remote-containers',
          {...manifest, name: 'remote-containers'},
          [
            'package.json',
            'LICENSE',
            'dist/extension.js',
            'dist/devcontainers-cli/ThirdPartyNotices.txt',
            'dist/devcontainers-cli/LICENSE.txt',
          ],
        ),
        vsixProblems(
          'remote-containers',
          {...manifest, name: 'remote-containers'},
          ['package.json', 'LICENSE', 'dist/devcontainers-cli/LICENSE.txt'],
        ),
      ],
      [[], []],
    );
  });

  it('tooling-95: the same names at a VSIX root, in another folder, or EULA.rtf, fail, in any package', () => {
    deepStrictEqual(
      [
        vsixProblems(
          'remote-containers',
          {...manifest, name: 'remote-containers'},
          [...files, 'ThirdPartyNotices.txt'],
        ),
        vsixProblems(
          'remote-ssh-edit',
          {...manifest, name: 'remote-ssh-edit'},
          [...files, 'ThirdPartyNotices.txt'],
        ),
        vsixProblems('remote-ssh', manifest, [
          ...files,
          'dist/ThirdPartyNotices.txt',
        ]),
        vsixProblems('remote-ssh', manifest, [...files, 'EULA.rtf']),
      ],
      [
        ['packages/remote-containers: the VSIX holds ThirdPartyNotices.txt'],
        ['packages/remote-ssh-edit: the VSIX holds ThirdPartyNotices.txt'],
        ['packages/remote-ssh: the VSIX holds dist/ThirdPartyNotices.txt'],
        ['packages/remote-ssh: the VSIX holds EULA.rtf'],
      ],
    );
  });

  it('tooling-95: NOTICE.md does not match the notices rule', () => {
    deepStrictEqual(
      vsixProblems('remote-ssh-edit', {...manifest, name: 'remote-ssh-edit'}, [
        'package.json',
        'LICENSE',
        'NOTICE.md',
      ]),
      [],
    );
  });

  it('tooling-95: a foreign publisher, or an id that is not shipped, is a problem', () => {
    deepStrictEqual(
      [
        vsixProblems(
          'remote-ssh',
          {
            ...manifest,
            publisher: 'foreign',
          },
          files,
        ),
        vsixProblems(
          'remote-ssh',
          {
            ...manifest,
            name: 'remote-not-shipped',
          },
          files,
        ),
      ],
      [
        [
          'packages/remote-ssh: the publisher is not remote-oss',
          'packages/remote-ssh: foreign.remote-ssh is not a shipped extension id',
        ],
        [
          'packages/remote-ssh: remote-oss.remote-not-shipped is not a shipped extension id',
        ],
      ],
    );
  });

  it('tooling-95: an engines value off the floor, or none, is a problem', () => {
    deepStrictEqual(
      [
        vsixProblems(
          'remote-ssh',
          {
            ...manifest,
            engines: {vscode: '^1.124.0'},
          },
          files,
        ),
        vsixProblems(
          'remote-ssh',
          {
            name: 'remote-ssh',
            publisher: 'remote-oss',
            license: 'MIT',
          },
          files,
        ),
      ],
      [
        [`packages/remote-ssh: engines.vscode is not ${EDITOR_ENGINE}`],
        [`packages/remote-ssh: engines.vscode is not ${EDITOR_ENGINE}`],
      ],
    );
  });

  it('tooling-95: an icon that is not in the list, or not a PNG, is a problem', () => {
    deepStrictEqual(
      [
        vsixProblems('remote-ssh', {...manifest, icon: 'icon.png'}, files),
        vsixProblems(
          'remote-ssh',
          {
            ...manifest,
            icon: 'icon.svg',
          },
          ['package.json', 'LICENSE', 'icon.svg'],
        ),
      ],
      [
        ['packages/remote-ssh: the icon icon.png is not in the VSIX'],
        ['packages/remote-ssh: the icon icon.svg is not a PNG'],
      ],
    );
  });

  it('tooling-95: the shipped ids are the release one and 0.2 set', () => {
    deepStrictEqual(SHIPPED_EXTENSION_IDS, [
      'remote-oss.remote-containers',
      'remote-oss.remote-ssh',
      'remote-oss.remote-ssh-edit',
      'remote-oss.remote-explorer',
      'remote-oss.vscode-remote-extensionpack',
    ]);
  });
});
