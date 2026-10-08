import {deepStrictEqual} from 'node:assert';
import {readConnectionRequest, type SharedRecord} from '../../src/index.ts';

const RECORD: SharedRecord = {
  remotePort: 41000,
  operatingSystem: 'linux',
  architecture: 'x64',
  temporaryFolder: '/tmp',
  connectionToken: 'token-value',
};

describe('connection requests (contracts §4 S9)', () => {
  it('reads the requests that carry nothing', () => {
    deepStrictEqual(
      ['connect', 'sharedRecord', 'kill'].map(type =>
        readConnectionRequest({type}),
      ),
      [{type: 'connect'}, {type: 'sharedRecord'}, {type: 'kill'}],
    );
  });

  it('reads a shared record to store', () => {
    deepStrictEqual(
      readConnectionRequest({type: 'setSharedRecord', record: {...RECORD}}),
      {
        type: 'setSharedRecord',
        record: RECORD,
      },
    );
  });

  it('reads an answer to a question', () => {
    deepStrictEqual(
      readConnectionRequest({type: 'answer', promptId: 3, text: 'yes'}),
      {
        type: 'answer',
        promptId: 3,
        text: 'yes',
      },
    );
  });

  it('reads nothing from a body that is not a request', () => {
    deepStrictEqual(
      [
        readConnectionRequest(null),
        readConnectionRequest([]),
        readConnectionRequest('connect'),
        readConnectionRequest({type: 'other'}),
        readConnectionRequest({type: 'answer', promptId: '3', text: 'yes'}),
        readConnectionRequest({type: 'answer', promptId: 3}),
        readConnectionRequest({type: 'setSharedRecord'}),
        readConnectionRequest({
          type: 'setSharedRecord',
          record: {...RECORD, remotePort: '41000'},
        }),
        readConnectionRequest({type: 'setSharedRecord', record: []}),
      ],
      [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('keeps only the record fields it knows', () => {
    deepStrictEqual(
      readConnectionRequest({
        type: 'setSharedRecord',
        record: {...RECORD, extra: 'x'},
      }),
      {type: 'setSharedRecord', record: RECORD},
    );
  });
});
