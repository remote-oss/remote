import {deepStrictEqual} from 'node:assert';
import {messageCellOf} from 'lib-ssh';
import {installPathHint} from '../../src/diagnostics/install-path-hint.ts';
import {ownText} from '../../src/surfaces/own-strings.ts';

describe('the hint of an install folder setting that is not a plain absolute path (card #2712)', () => {
  const hint = installPathHint('~x', template => template);

  it('F-2407 AC-17, BR-8 (card #2997): the stored hint holds the explanation as its message and the value as written as its details', () => {
    deepStrictEqual(
      [hint.status, hint.message, hint.details, hint.resources],
      [
        'InvalidCustomServerPath',
        'The provided custom server path is invalid',
        {text: 'Provided: "~x"'},
        [],
      ],
    );
  });

  it('F-2407 AC-9: the troubleshooting Message cell is the explanation followed by the value as written in parentheses', () => {
    deepStrictEqual(
      messageCellOf(
        hint.message as string,
        hint.details !== undefined && 'text' in hint.details
          ? hint.details.text
          : undefined,
      ),
      'The provided custom server path is invalid (Provided: "~x")',
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
