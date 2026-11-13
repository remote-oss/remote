import {deepStrictEqual} from 'node:assert';
import {hostIdentityOf} from './host-identity.ts';

describe('the host identity of the rows that build an image around the host user (card #2511, F-0403 AC-11, BR-6)', () => {
  it('F-0403 BR-6: a host with a user and a group id gives them to the remote user and gets the derived image; one without (Windows) gives 1000 and gets none', () => {
    deepStrictEqual(
      [
        hostIdentityOf({getuid: () => 1001, getgid: () => 118}),
        hostIdentityOf({}),
        hostIdentityOf({getuid: () => 1001}),
      ],
      [
        {userId: 1001, groupId: 118, synchronised: true},
        {userId: 1000, groupId: 1000, synchronised: false},
        {userId: 1000, groupId: 1000, synchronised: false},
      ],
    );
  });
});
