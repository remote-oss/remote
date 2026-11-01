import {deepStrictEqual} from 'node:assert';
import {
  SSH_LABEL_PREFIX_ID,
  workspaceSuffixOf,
} from '../../src/window/label-suffix.ts';

describe('workspaceSuffixOf (card remote-ssh-10 table)', () => {
  it('F-2502 BR-2: the prefix has its own id, not English', () => {
    deepStrictEqual(SSH_LABEL_PREFIX_ID, 'sshLabelPrefix');
  });

  it('F-2502 BR-2: a plain alias is the value of the prefix', () => {
    deepStrictEqual(workspaceSuffixOf({kind: 'plain', text: 'my-alias'}), {
      id: 'sshLabelPrefix',
      values: ['my-alias'],
    });
  });

  it('F-2502 BR-3: a plain user, address and port show the address and port', () => {
    deepStrictEqual(
      workspaceSuffixOf({kind: 'plain', text: 'u@192.0.2.10:2222'}).values,
      ['192.0.2.10:2222'],
    );
  });

  it('F-2502 BR-3: a host target shows its name without the user or port', () => {
    deepStrictEqual(
      workspaceSuffixOf({
        kind: 'host',
        hostName: 'my-alias',
        user: 'u',
        port: 2222,
      }).values,
      ['my-alias'],
    );
  });
});
