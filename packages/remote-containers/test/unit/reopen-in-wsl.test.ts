import {deepStrictEqual} from 'node:assert';
import {encodeAuthority} from 'lib-authority';
import {
  devContainerPayloadOf,
  type DevContainerFolder,
} from '../../src/authority/payload.ts';
import {canReopenInWSLOf} from '../../src/authority/reopen-in-wsl.ts';

const CONFIG = {
  $mid: 1 as const,
  fsPath: 'c:\\work\\app\\.devcontainer\\devcontainer.json',
  external: 'file:///c%3A/work/app/.devcontainer/devcontainer.json',
  path: '/c:/work/app/.devcontainer/devcontainer.json',
  scheme: 'file',
};
const FOLDER: DevContainerFolder = {
  kind: 'folder',
  hostPath: 'c:\\work\\app',
  localDocker: false,
  configFile: CONFIG,
};

/** The authority of a dev container window with `target`. */
function authorityOf(target: DevContainerFolder): string {
  return encodeAuthority({
    family: 'dev-container',
    target: {payload: devContainerPayloadOf(target)},
    rawHostString: 'x',
  });
}

describe('Reopen Folder in WSL is offered (card containers-203, F-0207 AC-53, F-1301 AC-3)', () => {
  it('F-0207 AC-53: a window whose payload names a distro, or whose folder is on a WSL share, can be reopened in WSL', () => {
    deepStrictEqual(
      [
        canReopenInWSLOf(authorityOf({...FOLDER, wslDistro: 'Ubuntu'})),
        canReopenInWSLOf(
          authorityOf({
            ...FOLDER,
            hostPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\app',
          }),
        ),
      ],
      [true, true],
    );
  });

  it('F-0207 AC-53: a window with a Windows folder and no distro, a legacy payload, another family, a malformed authority and no authority are not', () => {
    deepStrictEqual(
      [
        canReopenInWSLOf(authorityOf(FOLDER)),
        canReopenInWSLOf(
          encodeAuthority({
            family: 'dev-container',
            target: {payload: Buffer.from('c:\\work', 'utf8').toString('hex')},
            rawHostString: 'x',
          }),
        ),
        canReopenInWSLOf(
          encodeAuthority({
            family: 'attached-container',
            target: {payload: '7b7d'},
            rawHostString: 'x',
          }),
        ),
        canReopenInWSLOf('not an authority'),
        canReopenInWSLOf(undefined),
      ],
      [false, false, false, false, false],
    );
  });
});
