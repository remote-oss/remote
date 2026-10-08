import {deepStrictEqual} from 'node:assert';
import {fileTokens} from './ssh-config-editor.ts';

describe('SSH config tokens in the editor under test', () => {
  it('F-4101.AC-19: CRLF lines hold no token after their text', async () => {
    deepStrictEqual(await fileTokens('Host a\r\n\tUser\ttabuser\r\n'), [
      ['Host', 'support.type.property-name.ssh_config'],
      [' a', 'string.quoted.double.ssh_config'],
      ['\tUser', 'support.type.property-name.ssh_config'],
      ['\ttabuser', 'string.quoted.double.ssh_config'],
    ]);
  });

  it('F-4102.AC-7: a commented LF line holds one comment token', async () => {
    deepStrictEqual(await fileTokens('Host a\n    # # User admin\n'), [
      ['Host', 'support.type.property-name.ssh_config'],
      [' a', 'string.quoted.double.ssh_config'],
      ['    # # User admin', 'comment.line.hash.azcli'],
    ]);
  });
});
