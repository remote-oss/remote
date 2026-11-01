import {deepStrictEqual} from 'node:assert';
import {type DecodedTarget, encodeAuthority} from 'lib-authority';
import {
  type DevContainerFolder,
  decodedFolderOf,
  devContainerPayloadOf,
  devContainerTargetOf,
  folderTargetOf,
  type SerializedUri,
  serializedUriOf,
} from '../../src/authority/payload.ts';

const CONFIG_PATH = '/home/u/p/.devcontainer/devcontainer.json';
const CONFIG: SerializedUri = {
  $mid: 1,
  fsPath: CONFIG_PATH,
  external: `file://${CONFIG_PATH}`,
  path: CONFIG_PATH,
  scheme: 'file',
};
const FOLDER: DevContainerFolder = {
  kind: 'folder',
  hostPath: '/home/u/p',
  localDocker: false,
  configFile: CONFIG,
};

/** A folder whose configuration file is on the SSH host: no `fsPath` and no `external`. */
const SSH_FOLDER: DevContainerFolder = {
  ...FOLDER,
  configFile: {$mid: 1, path: CONFIG_PATH, scheme: 'vscode-fileHost'},
};

/** The lowercase hex of a text. */
function hexOf(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex');
}

/** The text a payload holds. */
function textOf(payload: string): string {
  return Buffer.from(payload, 'hex').toString('utf8');
}

describe('the dev-container payload', () => {
  it('F-0501 BR-2a: a folder target is the reference JSON text, in hex', () => {
    const payload = devContainerPayloadOf(FOLDER);
    deepStrictEqual(
      [textOf(payload), payload === payload.toLowerCase()],
      [
        '{"hostPath":"/home/u/p","localDocker":false,"configFile":{"$mid":1,"fsPath":"/home/u/p/.devcontainer/devcontainer.json","external":"file:///home/u/p/.devcontainer/devcontainer.json","path":"/home/u/p/.devcontainer/devcontainer.json","scheme":"file"}}',
        true,
      ],
    );
  });

  it('F-0501 BR-2a: a Docker context sits between localDocker and configFile', () => {
    const text = textOf(
      devContainerPayloadOf({...FOLDER, context: 'desktop-linux'}),
    );
    deepStrictEqual(
      [
        Object.keys(JSON.parse(text) as object),
        text.includes('"settings":{"context":"desktop-linux"},"configFile"'),
      ],
      [['hostPath', 'localDocker', 'settings', 'configFile'], true],
    );
  });

  it('F-0501 BR-2a: a host path with a space, a hash, a non-ASCII letter and a quote survives the round trip', () => {
    const target = {...FOLDER, hostPath: '/home/u/h #é "x"'};
    deepStrictEqual(
      devContainerTargetOf(devContainerPayloadOf(target)),
      target,
    );
  });

  for (const [name, target] of [
    ['no context', FOLDER],
    ['a context', {...FOLDER, context: 'ctx1'}],
    ['the SSH variant of the configuration file', SSH_FOLDER],
  ] as const) {
    it(`F-0501 BR-2a: the round trip of ${name} is the target`, () => {
      deepStrictEqual(
        devContainerTargetOf(devContainerPayloadOf(target)),
        target,
      );
    });
  }

  it('F-0501 BR-2a: the five members of a URI come from its properties and never from its toJSON', () => {
    let called = false;
    const uri = {
      fsPath: CONFIG_PATH,
      path: CONFIG_PATH,
      scheme: 'file',
      toString: () => `file://${CONFIG_PATH}`,
      toJSON: () => {
        called = true;
        return {$mid: 1, path: CONFIG_PATH, scheme: 'file'};
      },
    };
    deepStrictEqual(
      [JSON.stringify(serializedUriOf(uri)), called],
      [JSON.stringify(CONFIG), false],
    );
  });

  it('F-0501 BR-2a: the file system path of a URI is read from fsPath and not from path', () => {
    const uri = {
      fsPath: 'C:\\Users\\u\\p\\devcontainer.json',
      path: '/c:/Users/u/p/devcontainer.json',
      scheme: 'file',
      toString: () => 'file:///c%3A/Users/u/p/devcontainer.json',
    };
    deepStrictEqual(
      [serializedUriOf(uri).fsPath, serializedUriOf(uri).path],
      ['C:\\Users\\u\\p\\devcontainer.json', '/c:/Users/u/p/devcontainer.json'],
    );
  });

  it('F-0501 BR-2c: the hex of a plain host path is the legacy form', () => {
    deepStrictEqual(devContainerTargetOf(hexOf('/home/u/legacy')), {
      kind: 'legacy',
      hostPath: '/home/u/legacy',
    });
  });

  it('contracts §3: a payload that is empty, odd, not hex or in capitals is a malformed hex', () => {
    deepStrictEqual(
      ['', 'abc', 'zz', '7B'].map(payload => devContainerTargetOf(payload)),
      [
        {malformed: 'hex'},
        {malformed: 'hex'},
        {malformed: 'hex'},
        {malformed: 'hex'},
      ],
    );
  });

  it('contracts §3: a text that starts with a brace and does not parse is a malformed JSON', () => {
    deepStrictEqual(devContainerTargetOf(hexOf('{"hostPath":')), {
      malformed: 'json',
    });
  });

  it('contracts §3: each member of the wrong shape makes the payload malformed', () => {
    const file = {path: CONFIG_PATH, scheme: 'file'};
    const base = {hostPath: '/p', localDocker: false, configFile: file};
    const shapes = [
      {},
      {...base, hostPath: ''},
      {...base, hostPath: 5},
      {hostPath: '/p', configFile: file},
      {...base, localDocker: 'no'},
      {...base, settings: []},
      {...base, settings: {context: ''}},
      {hostPath: '/p', localDocker: false},
      {...base, configFile: {scheme: 'file'}},
      {...base, configFile: {path: CONFIG_PATH, scheme: 3}},
      {...base, configFile: {...file, fsPath: 3}},
      {...base, configFile: {...file, external: 3}},
    ];
    deepStrictEqual(
      shapes.map(shape => devContainerTargetOf(hexOf(JSON.stringify(shape)))),
      shapes.map(() => ({malformed: 'shape'})),
    );
  });

  it('contracts §3: a member that is not listed is ignored', () => {
    const text = JSON.stringify({
      hostPath: '/p',
      localDocker: false,
      extra: 1,
      configFile: {path: CONFIG_PATH, scheme: 'file'},
    });
    deepStrictEqual(devContainerTargetOf(hexOf(text)), {
      kind: 'folder',
      hostPath: '/p',
      localDocker: false,
      configFile: {$mid: 1, path: CONFIG_PATH, scheme: 'file'},
    });
  });

  it('contracts §3: the authority is the family, a plus and the payload unchanged', () => {
    const payload = devContainerPayloadOf(FOLDER);
    deepStrictEqual(
      encodeAuthority({
        family: 'dev-container',
        target: {payload},
        rawHostString: payload,
      }),
      `dev-container+${payload}`,
    );
  });
});

describe('the folder of a window’s decoded target (card containers-11)', () => {
  /** A dev-container target with `payload`. */
  function containerTarget(payload: string): DecodedTarget {
    return {family: 'dev-container', target: {payload}, rawHostString: payload};
  }

  it('F-0410: a folder payload names its folder', () => {
    deepStrictEqual(
      decodedFolderOf(containerTarget(devContainerPayloadOf(FOLDER))),
      FOLDER,
    );
  });

  it('F-0410: no target yet, a target with no payload, a legacy payload and a malformed one name no folder', () => {
    deepStrictEqual(
      [
        decodedFolderOf(undefined),
        decodedFolderOf({
          family: 'ssh-remote',
          target: {kind: 'plain', text: 'host'},
          rawHostString: 'host',
        }),
        decodedFolderOf(
          containerTarget(Buffer.from('/home/u/p').toString('hex')),
        ),
        decodedFolderOf(containerTarget('zz')),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });
});

describe('the folder target of a legacy entry (card containers-121)', () => {
  const LEGACY = {kind: 'legacy', hostPath: '/home/u/p'} as const;

  it('F-0501 AC-7: one configuration gives the folder target a Reopen carries, with no Docker context', () => {
    deepStrictEqual(folderTargetOf(LEGACY, [{file: CONFIG_PATH}]), {
      kind: 'folder',
      hostPath: '/home/u/p',
      localDocker: false,
      configFile: {$mid: 1, path: CONFIG_PATH, scheme: 'file'},
    });
  });

  it('F-0501 AC-7: several configurations give the first, in the order they come', () => {
    deepStrictEqual(
      folderTargetOf(LEGACY, [
        {file: '/home/u/p/.devcontainer.json'},
        {file: CONFIG_PATH},
      ])?.configFile.path,
      '/home/u/p/.devcontainer.json',
    );
  });

  it('F-0501 AC-7: no configuration gives none', () => {
    deepStrictEqual(folderTargetOf(LEGACY, []), undefined);
  });
});
