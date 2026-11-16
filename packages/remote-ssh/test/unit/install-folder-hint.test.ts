import {deepStrictEqual} from 'node:assert';
import {installFolderHint} from '../../src/diagnostics/install-folder-hint.ts';
import {ownText} from '../../src/surfaces/own-strings.ts';

describe('the hint of an install folder the host cannot create (card #2708)', () => {
  const hint = installFolderHint();

  it('F-2407 AC-13: the status, the message with the folder and the setting filled, and the failure as its details', () => {
    deepStrictEqual(
      [
        hint.status,
        typeof hint.message === 'string'
          ? hint.message
          : ownText(hint.message, template => template),
        hint.details,
      ],
      [
        'CreateInstallDirFailed',
        "The install directory on the remote host could not be created. By default this is the '$HOME' directory and can be overridden with the setting remote.SSH.serverInstallPath",
        {id: 'S070'},
      ],
    );
  });

  it('F-2602 AC-14: the first mitigation removes or edits the setting, then the parent folder, its permissions and the free space follow', () => {
    deepStrictEqual(
      hint.mitigations.map(each => ownText(each, template => template)),
      [
        'Remove or edit setting remote.SSH.serverInstallPath',
        'Ensure that the parent directory exists',
        'Ensure that the remote user has write permissions to the parent directory',
        'Ensure there is sufficient free disk space on the remote machine',
      ],
    );
  });

  it('F-2602 AC-14: the hint has no resources, so the table has no Resources column', () => {
    deepStrictEqual(hint.resources, []);
  });
});
