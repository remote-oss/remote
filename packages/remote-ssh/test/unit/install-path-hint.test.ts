import {deepStrictEqual} from 'node:assert';
import {installPathHint} from '../../src/diagnostics/install-path-hint.ts';
import {ownText} from '../../src/surfaces/own-strings.ts';

describe('the hint of an install folder setting that is not a plain absolute path (card #2712)', () => {
  const hint = installPathHint('~x', template => template);

  it('F-2407 AC-9: the status, and the message with the value as written after the explanation', () => {
    deepStrictEqual(
      [hint.status, hint.message, hint.details, hint.resources],
      [
        'InvalidCustomServerPath',
        'The provided custom server path is invalid (Provided: "~x")',
        undefined,
        [],
      ],
    );
  });

  it('F-2407 AC-9: the four mitigations are in order, the setting named in the second and the third', () => {
    deepStrictEqual(
      hint.mitigations.map(each => ownText(each, template => template)),
      [
        'Ensure the provide path is an absolute path',
        'Edit setting remote.SSH.serverInstallPath to an absolute path on the remote server',
        'Do not use variables, double quotes, or other non-path characters when setting remote.SSH.serverInstallPath',
        'Delete the setting for this host to use the default path in the user home directory',
      ],
    );
  });
});
