import {deepStrictEqual} from 'node:assert';
import {authorityHex} from './authority-hex.ts';

describe('the hexadecimal authority of the ssh-agents suite (card #2500, F-2008 AC-6)', () => {
  it('F-2008 AC-6: the keys come in the order hostName, user, port, and the port is a number', () => {
    deepStrictEqual(
      [
        authorityHex({hostName: 'harness', user: 'me'}),
        authorityHex({hostName: '127.0.0.1', user: 'me', port: 2222}),
      ],
      [
        Buffer.from('{"hostName":"harness","user":"me"}').toString('hex'),
        '7b22686f73744e616d65223a223132372e302e302e31222c2275736572223a226d65222c22706f7274223a323232327d',
      ],
    );
  });
});
