import {deepStrictEqual} from 'node:assert';
import {encodeAuthority} from 'lib-authority';
import {
  type DevContainerFolder,
  devContainerPayloadOf,
  devContainerTargetOf,
  serializedUriOf,
} from '../../src/authority/payload.ts';

const CONFIG = '/home/u/p/.devcontainer/devcontainer.json';

const FOLDER: DevContainerFolder = {
  kind: 'folder',
  hostPath: '/home/u/p',
  localDocker: false,
  configFile: {
    $mid: 1,
    fsPath: CONFIG,
    external: `file://${CONFIG}`,
    path: CONFIG,
    scheme: 'file',
  },
};

/** The lowercase hex of a text, as the payload is written. */
function hexOf(text: string): string {
  return Buffer.from(text, 'utf8').toString('hex');
}

/** The text a payload holds. */
function textOf(payload: string): string {
  return Buffer.from(payload, 'hex').toString('utf8');
}

describe('the dev-container payload (card containers-07)', () => {
  it('F-0501 BR-2a: a folder with no context is the JSON text of the observed form, in lowercase hex', () => {
    const payload = devContainerPayloadOf(FOLDER);
    deepStrictEqual(
      [
        textOf(payload),
        payload === hexOf(textOf(payload)),
        payload === payload.toLowerCase(),
      ],
      [
        `{"hostPath":"/home/u/p","localDocker":false,"configFile":{"$mid":1,"fsPath":"${CONFIG}","external":"file://${CONFIG}","path":"${CONFIG}","scheme":"file"}}`,
        true,
        true,
      ],
    );
  });

  it('F-0501 BR-2a: a context sits between localDocker and configFile', () => {
    deepStrictEqual(
      textOf(
        devContainerPayloadOf({...FOLDER, context: 'desktop-linux'}),
      ).includes(
        '"localDocker":false,"settings":{"context":"desktop-linux"},"configFile":',
      ),
      true,
    );
  });

  it('F-0501 BR-2a: a host path with a space, a hash, a letter outside ASCII and a quote survives the round trip', () => {
    const target: DevContainerFolder = {
      ...FOLDER,
      hostPath: '/home/u/a b#é"c',
    };
    deepStrictEqual(
      devContainerTargetOf(devContainerPayloadOf(target)),
      target,
    );
  });

  it('F-0501 BR-2a: the round trip keeps a target with no context, with a context, and the SSH variant of the configuration file', () => {
    const targets: DevContainerFolder[] = [
      FOLDER,
      {...FOLDER, context: 'desktop-linux'},
      {
        ...FOLDER,
        configFile: {$mid: 1, path: CONFIG, scheme: 'vscode-fileHost'},
      },
    ];
    deepStrictEqual(
      targets.map(target =>
        devContainerTargetOf(devContainerPayloadOf(target)),
      ),
      targets,
    );
  });

  it('F-0501 BR-2a: a URI is serialized from its parts in the editor’s order, without asking it to serialize itself', () => {
    let serialized = 0;
    const uri = {
      fsPath: CONFIG,
      path: CONFIG,
      scheme: 'file',
      toString: () => `file://${CONFIG}`,
      toJSON: () => {
        serialized += 1;
        return {$mid: 1, path: CONFIG, scheme: 'file'};
      },
    };
    const result = serializedUriOf(uri);
    deepStrictEqual(
      [Object.entries(result), serialized],
      [
        [
          ['$mid', 1],
          ['fsPath', CONFIG],
          ['external', `file://${CONFIG}`],
          ['path', CONFIG],
          ['scheme', 'file'],
        ],
        0,
      ],
    );
  });

  it('F-0501 BR-2c: the hex of a plain path is the older form', () => {
    deepStrictEqual(devContainerTargetOf(hexOf('/home/u/legacy')), {
      kind: 'legacy',
      hostPath: '/home/u/legacy',
    });
  });

  it('contracts §3: an empty text, an odd one, a text that is not hex and an uppercase one are malformed hex', () => {
    deepStrictEqual(['', 'abc', 'zz', '7B'].map(devContainerTargetOf), [
      {malformed: 'hex'},
      {malformed: 'hex'},
      {malformed: 'hex'},
      {malformed: 'hex'},
    ]);
  });

  it('contracts §3: a text that starts like JSON and is not is malformed JSON', () => {
    deepStrictEqual(devContainerTargetOf(hexOf('{"hostPath":')), {
      malformed: 'json',
    });
  });

  for (const [name, change] of [
    ['an empty object', {}],
    ['an empty host path', {hostPath: ''}],
    ['a host path that is a number', {hostPath: 5}],
    ['no localDocker', {localDocker: undefined}],
    ['a localDocker that is a text', {localDocker: 'no'}],
    ['settings that is an array', {settings: []}],
    ['settings with no context', {settings: {}}],
    ['an empty context', {settings: {context: ''}}],
    ['no configuration file', {configFile: undefined}],
    [
      'a configuration file without a path',
      {configFile: {$mid: 1, scheme: 'file'}},
    ],
    [
      'a scheme that is a number',
      {configFile: {$mid: 1, path: CONFIG, scheme: 3}},
    ],
    [
      'an fsPath that is a number',
      {configFile: {$mid: 1, path: CONFIG, scheme: 'file', fsPath: 3}},
    ],
    [
      'an external that is a number',
      {configFile: {$mid: 1, path: CONFIG, scheme: 'file', external: 3}},
    ],
    ['a configuration file that is a text', {configFile: 'x'}],
  ] as const) {
    it(`contracts §3: ${name} is a malformed shape`, () => {
      const base = {
        hostPath: '/home/u/p',
        localDocker: false,
        configFile: {$mid: 1, path: CONFIG, scheme: 'file'},
      };
      const text = JSON.stringify(
        name === 'an empty object' ? {} : {...base, ...change},
      );
      deepStrictEqual(devContainerTargetOf(hexOf(text)), {malformed: 'shape'});
    });
  }

  it('contracts §3: a member the payload does not list is ignored', () => {
    deepStrictEqual(
      devContainerTargetOf(
        hexOf(
          JSON.stringify({
            hostPath: '/home/u/p',
            localDocker: false,
            extra: 1,
            configFile: {$mid: 1, path: CONFIG, scheme: 'file'},
          }),
        ),
      ),
      {
        kind: 'folder',
        hostPath: '/home/u/p',
        localDocker: false,
        configFile: {$mid: 1, path: CONFIG, scheme: 'file'},
      },
    );
  });

  it('contracts §3: the authority of a payload is dev-container+ and the payload unchanged', () => {
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
