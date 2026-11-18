import {deepStrictEqual} from 'node:assert';
import {
  containerLabel,
  coreButtons,
  engineSuffix,
  shownLabel,
} from '../tests/acceptance/windows/platform-forms.ts';

describe('the forms of a value on the platform of the run (card #2828)', () => {
  it('#2828: core puts the primary button last on Linux and first on Windows, the others in their order', () => {
    deepStrictEqual(
      [
        coreButtons(['Cancel', 'Reload Window'], 'linux'),
        coreButtons(['Cancel', 'Reload Window'], 'win32'),
        coreButtons(
          ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
          'win32',
        ),
        coreButtons([], 'win32'),
      ],
      [
        ['Cancel', 'Reload Window'],
        ['Reload Window', 'Cancel'],
        ['Retry', 'Edit devcontainer.json Locally', 'More Actions...'],
        [],
      ],
    );
  });

  it('#2828: the engine is named after the window on Windows with a TCP engine, and not on Linux or with another engine', () => {
    deepStrictEqual(
      [
        engineSuffix('tcp://127.0.0.1:61168', 'win32'),
        engineSuffix('tcp://127.0.0.1:61168', 'linux'),
        engineSuffix('npipe:////./pipe/docker_engine', 'win32'),
        engineSuffix(undefined, 'win32'),
      ],
      [' @ tcp://127.0.0.1:61168', '', '', ''],
    );
  });

  it('#2828: the status bar cuts a label of more than 40 characters, and the label of a dev container carries the suffix first', () => {
    deepStrictEqual(
      [
        shownLabel('Dev Container: short'),
        containerLabel('c43-stop', 'tcp://127.0.0.1:61168', 'win32'),
        containerLabel('c43-restart', 'tcp://127.0.0.1:61168', 'win32'),
        containerLabel('c43-stop', 'tcp://127.0.0.1:61168', 'linux'),
      ],
      [
        'Dev Container: short',
        'Dev Container: c43-stop @ tcp://127.0.0.…',
        'Dev Container: c43-restart @ tcp://127.0…',
        'Dev Container: c43-stop',
      ],
    );
  });
});
