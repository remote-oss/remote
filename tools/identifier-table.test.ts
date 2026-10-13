import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {syntheticSources} from './identifier-fixtures.ts';
import {descriptiveNames, tableKinds, tableSource} from './identifier-table.ts';

describe('identifier-table', () => {
  describe('names', () => {
    function namesOf(identifiers: string[]): string[] {
      return [
        ...descriptiveNames(
          new Map(identifiers.map(identifier => [identifier, identifier])),
        ).keys(),
      ];
    }

    it('keys each value by its name', () => {
      deepStrictEqual(
        descriptiveNames(new Map([['remote-x.reopenInContainer', 1]])),
        new Map([['reopenInContainer', 1]]),
      );
    });

    it('names an id by the camel case of its last segment', () => {
      deepStrictEqual(
        namesOf(['remote-x.reopenInContainer', 'remote.SSH.configFile']),
        ['reopenInContainer', 'configFile'],
      );
    });

    it('joins the words of a segment and lower-cases each capital run', () => {
      deepStrictEqual(
        namesOf(['ssh_config', 'SSH-remote', 'dev-container', 'open-SSH']),
        ['sshConfig', 'sshRemote', 'devContainer', 'openSsh'],
      );
    });

    it('widens a name shorter than four characters by the segment before it', () => {
      deepStrictEqual(namesOf(['remote-x.SSH.add']), ['sshAdd']);
    });

    it('widens two ids whose last segments collide until they differ', () => {
      deepStrictEqual(
        namesOf(['dev.containers.dockerPath', 'remote.SSH.dockerPath']),
        ['containersDockerPath', 'sshDockerPath'],
      );
    });

    it('widens a name that starts with a digit', () => {
      deepStrictEqual(namesOf(['remote-x.panel.2column']), ['panel2column']);
    });

    it('fails when an id runs out of segments', () => {
      throws(() => namesOf(['abc']), {
        message:
          "no descriptive name for 'abc': its segments give 'abc', which is too short, not a name, or shared",
      });
    });

    it('fails for an id without words', () => {
      throws(() => namesOf(['-']), {
        message:
          "no descriptive name for '-': its segments give '', which is too short, not a name, or shared",
      });
    });
  });

  describe('kinds', () => {
    it('has no kind and no table for a package without identifiers', () => {
      strictEqual(tableSource(syntheticSources()), undefined);
    });

    it('gives each command its palette flag and R-46 policy', () => {
      const [commands] = tableKinds(
        syntheticSources({
          manifest: {
            commands: [
              {id: 'remote-x.open', title: '%open%', palette: true},
              {id: 'remote-x.close', title: 'Close', palette: false},
            ],
          },
          declared: {infoLineCommands: ['remote-x.open']},
        }),
      );
      deepStrictEqual(
        commands?.entries,
        new Map([
          [
            'open',
            {
              id: 'remote-x.open',
              title: '%open%',
              palette: true,
              policy: 'infoLine',
            },
          ],
          [
            'close',
            {
              id: 'remote-x.close',
              title: 'Close',
              palette: false,
              policy: 'silent',
            },
          ],
        ]),
      );
    });

    it('folds a legacy setting into its current key with the winner (F-0102 BR-4)', () => {
      const [settings] = tableKinds(
        syntheticSources({
          manifest: {
            settings: [
              {id: 'dev.containers.dockerPath', scope: 'machine'},
              {id: 'remote.containers.dockerPath', scope: 'application'},
              {id: 'dev.containers.logLevel', scope: 'window'},
            ],
          },
          declared: {
            settingPairs: [
              {
                current: 'dev.containers.dockerPath',
                legacy: 'remote.containers.dockerPath',
                winner: 'current',
              },
            ],
          },
        }),
      );
      deepStrictEqual(
        settings?.entries,
        new Map([
          [
            'dockerPath',
            {
              id: 'dev.containers.dockerPath',
              scope: 'machine',
              legacyId: 'remote.containers.dockerPath',
              legacyScope: 'application',
              winner: 'current',
            },
          ],
          ['logLevel', {id: 'dev.containers.logLevel', scope: 'window'}],
        ]),
      );
    });

    it('gives a legacy twin the default window scope when the manifest does not contribute it', () => {
      const [settings] = tableKinds(
        syntheticSources({
          manifest: {settings: [{id: 'dotfiles.repository', scope: 'machine'}]},
          declared: {
            settingPairs: [
              {
                current: 'dotfiles.repository',
                legacy: 'remote.containers.dotfiles.repository',
                winner: 'legacy',
              },
            ],
          },
        }),
      );
      deepStrictEqual(
        settings?.entries,
        new Map([
          [
            'repository',
            {
              id: 'dotfiles.repository',
              scope: 'machine',
              legacyId: 'remote.containers.dotfiles.repository',
              legacyScope: 'window',
              winner: 'legacy',
            },
          ],
        ]),
      );
    });

    it('lists the declared context keys and the standing-down key', () => {
      const [contextKeys] = tableKinds(
        syntheticSources({
          declared: {
            contextKeys: [{id: 'remote-x.connected', setter: 'core'}],
            standingDownKey: 'remote-x.standingDown',
          },
        }),
      );
      deepStrictEqual(
        contextKeys?.entries,
        new Map([
          ['connected', {id: 'remote-x.connected', setter: 'core'}],
          ['standingDown', {id: 'remote-x.standingDown', setter: 'extension'}],
        ]),
      );
    });

    it('adds the stand-down kind with the named key', () => {
      const kinds = tableKinds(
        syntheticSources({
          declared: {standingDownKey: 'remote-x.standingDown'},
        }),
      );
      deepStrictEqual(
        kinds.map(kind => kind.name),
        ['contextKeys', 'standDown'],
      );
    });

    it('adds the stand-down kind with an empty key while the key is pending', () => {
      deepStrictEqual(
        tableKinds(syntheticSources({declared: {standingDownKey: ''}})),
        [
          {
            name: 'standDown',
            documentation:
              'The extension this package stands down for, and the key set while it does; the key is empty until it is named.',
            entries: new Map([
              ['standsDownFor', 'ms-vscode-remote.remote-x'],
              ['contextKey', ''],
            ]),
          },
        ],
      );
    });

    it('leaves out the stand-down kind for a package that never stands down', () => {
      deepStrictEqual(tableKinds(syntheticSources()), []);
    });

    it('leaves out the stand-down kind without an extension to stand down for', () => {
      const kinds = tableKinds(
        syntheticSources({
          declared: {
            standsDownFor: '',
            standingDownKey: 'remote-x.standingDown',
          },
        }),
      );
      deepStrictEqual(
        kinds.map(kind => kind.name),
        ['contextKeys'],
      );
    });

    it('lists the kinds in a fixed order and leaves out the empty ones', () => {
      const kinds = tableKinds(
        syntheticSources({
          manifest: {
            views: ['remote-x.targets'],
            authorities: ['ssh-remote'],
            languages: ['ssh_config'],
          },
          declared: {
            internal: [
              {id: 'remote-internal.get', role: 'served', kind: 'query'},
            ],
          },
        }),
      );
      deepStrictEqual(
        kinds.map(kind => kind.name),
        ['views', 'authorities', 'languages', 'internalCommands'],
      );
    });
  });

  describe('runtime commands', () => {
    it('are written as a plain table named by their last segment', () => {
      strictEqual(
        tableSource(
          syntheticSources({
            declared: {
              runtimeCommands: [
                {id: 'opensshremotes.showDetails', purpose: 'p'},
              ],
            },
          }),
        ),
        [
          '/**',
          ' * @fileoverview The identifiers of packages/remote-x, generated by tools/identifiers.ts from its',
          ' * package.json and identifiers.json. `pnpm identifiers` writes it again.',
          ' */',
          '',
          '/** The reference command ids of identifiers.json that the extension registers at runtime only. */',
          'export const runtimeCommands = {',
          '  showDetails: "opensshremotes.showDetails",',
          '} as const;',
          '',
        ].join('\n'),
      );
    });
  });

  describe('the proposals a manifest ships (card connect-31)', () => {
    it('connect-31: are written as one constant in the manifest order', () => {
      strictEqual(
        tableSource(
          syntheticSources({
            manifest: {enabledApiProposals: ['resolvers', 'tunnels']},
          }),
        )?.endsWith(
          '/** The proposed APIs the package\'s manifest enables, in its order: what the build ships, whatever the editor keeps. */\nexport const enabledApiProposals = ["resolvers","tunnels"] as const;\n',
        ),
        true,
      );
    });

    it('connect-31: a package with proposals and no other identifier still gets a table', () => {
      strictEqual(
        tableSource(
          syntheticSources({manifest: {enabledApiProposals: ['resolvers']}}),
        )?.includes('enabledApiProposals'),
        true,
      );
    });

    it('connect-31: a package without proposals has no such constant', () => {
      strictEqual(
        tableSource(
          syntheticSources({manifest: {languages: ['ssh_config']}}),
        )?.includes('enabledApiProposals'),
        false,
      );
    });
  });

  describe('source', () => {
    it('writes one documented constant per kind', () => {
      strictEqual(
        tableSource(
          syntheticSources({
            manifest: {languages: ['ssh_config']},
            declared: {
              internal: [
                {id: 'remote-internal.get', role: 'called', kind: 'query'},
              ],
            },
          }),
        ),
        [
          '/**',
          ' * @fileoverview The identifiers of packages/remote-x, generated by tools/identifiers.ts from its',
          ' * package.json and identifiers.json. `pnpm identifiers` writes it again.',
          ' */',
          '',
          '/** The language ids of `contributes.languages`. */',
          'export const languages = {',
          '  sshConfig: "ssh_config",',
          '} as const;',
          '',
          '/** The internal command ids of identifiers.json, served or called. */',
          'export const internalCommands = {',
          '  remoteInternalGet: {id: "remote-internal.get", role: "called", kind: "query"},',
          '} as const;',
          '',
        ].join('\n'),
      );
    });
  });
});
