import {deepStrictEqual, throws} from 'node:assert';
import path from 'node:path';
import {
  hasSources,
  readDeclared,
  readManifest,
  readPackageSources,
} from './identifier-sources.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('identifier-sources', () => {
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('identifier-sources');
  });

  afterEach(() => {
    workspace.remove();
  });

  function manifestOf(content: unknown): ReturnType<typeof readManifest> {
    workspace.write('package.json', content);
    return readManifest(path.join(workspace.root, 'package.json'), 'manifest');
  }

  function declaredOf(content: unknown): ReturnType<typeof readDeclared> {
    workspace.write('identifiers.json', content);
    return readDeclared(
      path.join(workspace.root, 'identifiers.json'),
      'declared',
    );
  }

  describe('manifest', () => {
    it('reads a manifest without contributions as empty', () => {
      deepStrictEqual(manifestOf({name: 'empty'}), {
        commands: [],
        settings: [],
        views: [],
        authorities: [],
        languages: [],
        activationEvents: [],
        menuEntries: [],
        stringReferences: [],
      });
    });

    it('marks a command hidden from the palette by when false', () => {
      const manifest = manifestOf({
        contributes: {
          commands: [
            {command: 'remote-x.shown', title: 'Shown'},
            {command: 'remote-x.hidden', title: 'Hidden'},
          ],
          menus: {
            commandPalette: [{command: 'remote-x.hidden', when: 'false'}],
          },
        },
      });
      deepStrictEqual(manifest.commands, [
        {id: 'remote-x.shown', title: 'Shown', palette: true},
        {id: 'remote-x.hidden', title: 'Hidden', palette: false},
      ]);
    });

    it('reads settings from one configuration object with the default scope', () => {
      const manifest = manifestOf({
        contributes: {
          configuration: {
            properties: {
              'remote.X.first': {scope: 'machine'},
              'remote.X.second': {},
            },
          },
        },
      });
      deepStrictEqual(manifest.settings, [
        {id: 'remote.X.first', scope: 'machine'},
        {id: 'remote.X.second', scope: 'window'},
      ]);
    });

    it('reads settings from a configuration array, skipping a section without properties', () => {
      const manifest = manifestOf({
        contributes: {
          configuration: [
            {title: 'Empty'},
            {properties: {'remote.X.third': {scope: 'application'}}},
          ],
        },
      });
      deepStrictEqual(manifest.settings, [
        {id: 'remote.X.third', scope: 'application'},
      ]);
    });

    it('reads views of every container', () => {
      const manifest = manifestOf({
        contributes: {
          views: {
            remote: [{id: 'remote-x.targets'}],
            explorer: [{id: 'remote-x.files'}],
          },
        },
      });
      deepStrictEqual(manifest.views, ['remote-x.targets', 'remote-x.files']);
    });

    it('reads authorities from activation events and deduplicates languages', () => {
      const manifest = manifestOf({
        activationEvents: [
          'onResolveRemoteAuthority:ssh-remote',
          'onCommand:remote-x.open',
        ],
        contributes: {
          languages: [{id: 'ssh_config'}, {id: 'ssh_config'}],
        },
      });
      deepStrictEqual(
        [manifest.authorities, manifest.languages, manifest.activationEvents],
        [
          ['ssh-remote'],
          ['ssh_config'],
          ['onResolveRemoteAuthority:ssh-remote', 'onCommand:remote-x.open'],
        ],
      );
    });

    it('reads menu, submenu, welcome and edit-session entries', () => {
      const manifest = manifestOf({
        contributes: {
          menus: {
            'view/title': [
              {command: 'remote-x.refresh', when: 'view == remote-x.targets'},
              {submenu: 'remote-x.more'},
            ],
          },
          viewsWelcome: [{view: 'remote-x.targets', when: 'true'}],
          continueEditSession: [{command: 'remote-x.continue'}],
        },
      });
      deepStrictEqual(manifest.menuEntries, [
        {
          menu: 'view/title',
          item: 'remote-x.refresh',
          when: 'view == remote-x.targets',
        },
        {menu: 'view/title', item: 'remote-x.more'},
        {menu: 'viewsWelcome', item: 'remote-x.targets', when: 'true'},
        {menu: 'continueEditSession', item: 'remote-x.continue'},
      ]);
    });

    it('collects every %key% reference once, at any depth', () => {
      const manifest = manifestOf({
        description: '%description%',
        displayName: 'Plain',
        contributes: {
          commands: [
            {command: 'remote-x.open', title: '%open%', category: '%cat%'},
            {command: 'remote-x.close', title: '%open%'},
          ],
        },
        keywords: ['%keyword%', 'plain'],
      });
      deepStrictEqual(manifest.stringReferences, [
        'description',
        'open',
        'cat',
        'keyword',
      ]);
    });

    it('fails on a command without a string title, naming the place', () => {
      throws(
        () => manifestOf({contributes: {commands: [{command: 'remote-x.a'}]}}),
        {message: 'manifest.contributes.commands[0].title must be a string'},
      );
    });

    it('fails on commands that are not an array', () => {
      throws(() => manifestOf({contributes: {commands: {}}}), {
        message: 'manifest.contributes.commands must be an array',
      });
    });

    it('fails on views that are not an object', () => {
      throws(() => manifestOf({contributes: {views: []}}), {
        message: 'manifest.contributes.views must be an object',
      });
    });

    it('fails on a file that is not JSON', () => {
      workspace.write('package.json', '{');
      throws(
        () =>
          readManifest(path.join(workspace.root, 'package.json'), 'manifest'),
        /^Error: manifest is not valid JSON: /,
      );
    });
  });

  describe('identifiers.json', () => {
    it('defaults every optional field', () => {
      deepStrictEqual(declaredOf({source: 'x#1', reference: 'ms.x'}), {
        source: 'x#1',
        reference: 'ms.x',
        namespaces: {},
        contextKeys: [],
        infoLineCommands: [],
        internal: [],
        invented: [],
        settingPairs: [],
        ungated: [],
      });
    });

    it('reads every field', () => {
      const content = {
        source: 'remote-oss/remote-x#1 (F-0001)',
        reference: 'ms.x',
        standingDownKey: 'remote-x.standingDown',
        namespaces: {commands: ['remote-x.'], contextKeys: ['remote-x.']},
        contextKeys: [{id: 'remote-x.connected', setter: 'extension'}],
        infoLineCommands: ['remote-x.open'],
        internal: [{id: 'remote-internal.get', role: 'served', kind: 'query'}],
        invented: [
          {
            id: 'remote-x.standingDown',
            kind: 'contextKeys',
            spec: 'F-0001',
            date: '2026-10-06',
          },
        ],
        settingPairs: [
          {current: 'dev.x.path', legacy: 'remote.x.path', winner: 'legacy'},
        ],
        ungated: [{menu: 'commandPalette', item: 'remote-x.open', reason: 'r'}],
        locales: ['de', 'fr'],
      };
      deepStrictEqual(declaredOf(content), content);
    });

    it('fails on an unknown top-level field', () => {
      throws(() => declaredOf({source: 'x', reference: 'r', extra: 1}), {
        message: 'declared has unknown fields: extra',
      });
    });

    it('fails on an unknown field of an entry', () => {
      throws(
        () =>
          declaredOf({
            source: 'x',
            reference: 'r',
            contextKeys: [{id: 'k', setter: 'core', note: 'n'}],
          }),
        {message: 'declared.contextKeys[0] has unknown fields: note'},
      );
    });

    it('fails on an unknown namespace kind', () => {
      throws(
        () =>
          declaredOf({source: 'x', reference: 'r', namespaces: {menus: []}}),
        {message: 'declared.namespaces has unknown fields: menus'},
      );
    });

    it('fails on a value outside its allowed set', () => {
      throws(
        () =>
          declaredOf({
            source: 'x',
            reference: 'r',
            internal: [{id: 'i', role: 'owned', kind: 'query'}],
          }),
        {message: 'declared.internal[0].role must be one of served, called'},
      );
    });

    it('fails on an empty source', () => {
      throws(() => declaredOf({source: ' ', reference: 'r'}), {
        message: 'declared.source must be a non-empty string',
      });
    });

    it('fails on an exemption without a reason (stand-down gating, ungated)', () => {
      throws(
        () =>
          declaredOf({
            source: 'x',
            reference: 'r',
            ungated: [{menu: 'commandPalette', item: 'remote-x.a', reason: ''}],
          }),
        {message: 'declared.ungated[0].reason must be a non-empty string'},
      );
    });

    it('fails on a missing reference', () => {
      throws(() => declaredOf({source: 'x'}), {
        message: 'declared.reference must be a string',
      });
    });

    it('fails on a file that is not an object', () => {
      throws(() => declaredOf([]), {message: 'declared must be an object'});
    });
  });

  describe('packages', () => {
    it('reads a package without identifiers.json', () => {
      workspace.writeManifest('remote-x');
      const sources = readPackageSources(workspace.root, 'remote-x');
      deepStrictEqual(
        [sources.folder, sources.declared],
        ['remote-x', undefined],
      );
    });

    it('reads a package with identifiers.json', () => {
      workspace.writeManifest('remote-x');
      workspace.write('packages/remote-x/identifiers.json', {
        source: 'x#1',
        reference: 'ms.x',
      });
      deepStrictEqual(
        readPackageSources(workspace.root, 'remote-x').declared?.reference,
        'ms.x',
      );
    });

    it('names the package file in a shape error', () => {
      workspace.writeManifest('remote-x');
      workspace.write('packages/remote-x/identifiers.json', {source: 'x'});
      throws(() => readPackageSources(workspace.root, 'remote-x'), {
        message:
          'packages/remote-x/identifiers.json.reference must be a string',
      });
    });

    it('tells a package with src/ from one without', () => {
      workspace.write('packages/with/src/extension.ts', '');
      workspace.writeManifest('without');
      deepStrictEqual(
        [
          hasSources(path.join(workspace.root, 'packages/with')),
          hasSources(path.join(workspace.root, 'packages/without')),
        ],
        [true, false],
      );
    });
  });
});
