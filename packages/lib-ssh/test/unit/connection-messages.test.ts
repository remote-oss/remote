import {deepStrictEqual} from 'node:assert';
import {
  readConnectionRequest,
  readConnectionReply,
  type SharedRecord,
} from '../../src/index.ts';

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
      ['connect', 'sharedRecord', 'kill', 'checkSession'].map(type =>
        readConnectionRequest({type}),
      ),
      [
        {type: 'connect'},
        {type: 'sharedRecord'},
        {type: 'kill'},
        {type: 'checkSession'},
      ],
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

  it("ruling-2995-takeup-cleanup: reads a record's data folder, and drops one that is empty or no text", () => {
    function folderOf(dataFolder: string | number): unknown {
      const request = readConnectionRequest({
        type: 'setSharedRecord',
        record: {...RECORD, dataFolder},
      });
      return request?.type === 'setSharedRecord'
        ? request.record.dataFolder
        : 'unread';
    }
    deepStrictEqual(
      [folderOf('/home/u/.server'), folderOf(''), folderOf(7)],
      ['/home/u/.server', undefined, undefined],
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

  it('reads the refuse of a question', () => {
    deepStrictEqual(
      [
        readConnectionRequest({type: 'refuse', promptId: 3}),
        readConnectionRequest({type: 'refuse', promptId: '3'}),
        readConnectionRequest({type: 'refuse'}),
      ],
      [{type: 'refuse', promptId: 3}, undefined, undefined],
    );
  });

  it('reads the refusal of a question, and still reads the refusals with their reasons', () => {
    deepStrictEqual(
      [
        readConnectionReply({type: 'questionRefused', accepted: true}),
        readConnectionReply({type: 'questionRefused', accepted: false}),
        readConnectionReply({type: 'questionRefused'}),
        readConnectionReply({type: 'refused', accepted: 'no'}),
        readConnectionReply({type: 'refused', reason: 'notOwner'}),
        readConnectionReply({type: 'refused', reason: 7}),
      ],
      [
        {type: 'questionRefused', accepted: true},
        {type: 'questionRefused', accepted: false},
        undefined,
        undefined,
        {type: 'refused', reason: 'notOwner'},
        undefined,
      ],
    );
  });

  it('F-2505 AC-25: reads the answer of a session check, and nothing from one without its flag', () => {
    deepStrictEqual(
      [
        readConnectionReply({type: 'sessionChecked', alive: true}),
        readConnectionReply({type: 'sessionChecked', alive: false}),
        readConnectionReply({type: 'sessionChecked'}),
        readConnectionReply({type: 'sessionChecked', alive: 'yes'}),
      ],
      [
        {type: 'sessionChecked', alive: true},
        {type: 'sessionChecked', alive: false},
        undefined,
        undefined,
      ],
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

  it('reads the plans of the agent link and the display a record carries', () => {
    const plans = [
      {
        agentLink: {kind: 'none', reason: 'settingOff'},
        display: {kind: 'none', reason: 'settingOff'},
      },
      {
        agentLink: {kind: 'none', reason: 'noForwardedSocket'},
        display: {kind: 'none', reason: 'noSessionDisplay'},
      },
      {
        agentLink: {
          kind: 'link',
          linkPath: '/tmp/vscode-ssh-auth-sock-12',
          target: '/tmp/ssh-x/agent.7',
        },
        display: {kind: 'display', value: 'localhost:10.0'},
      },
    ];
    deepStrictEqual(
      plans.map(fields =>
        readConnectionRequest({
          type: 'setSharedRecord',
          record: {...RECORD, ...fields},
        }),
      ),
      plans.map(fields => ({
        type: 'setSharedRecord',
        record: {...RECORD, ...fields},
      })),
    );
  });

  it('reads a malformed plan of a record as absent and keeps the record', () => {
    const malformed = [
      {agentLink: 'link', display: null},
      {agentLink: {kind: 'none', reason: 'other'}, display: {kind: 'none'}},
      {
        agentLink: {kind: 'link', linkPath: 5, target: '/tmp/a'},
        display: {kind: 'display', value: 10},
      },
      {
        agentLink: {kind: 'link', linkPath: '/tmp/l'},
        display: {kind: 'other', value: ':0'},
      },
    ];
    deepStrictEqual(
      malformed.map(fields =>
        readConnectionRequest({
          type: 'setSharedRecord',
          record: {...RECORD, ...fields},
        }),
      ),
      malformed.map(() => ({type: 'setSharedRecord', record: RECORD})),
    );
  });

  it('reads a script to run on the session', () => {
    const bodies = [
      {runId: 1, script: 'echo x', environment: {}, inputBase64: null},
      {runId: 2, script: 'cat', environment: {NAME: 'b'}, inputBase64: 'AQID'},
    ].map(fields => ({
      type: 'runScript',
      ...fields,
      deadlineMilliseconds: 1000,
    }));
    deepStrictEqual(
      bodies.map(body => readConnectionRequest(body)),
      bodies,
    );
  });

  it('F-2408 BR-4: reads the session lock of a script, open or release, and none when there is none', () => {
    const complete = {
      type: 'runScript',
      runId: 1,
      script: 'x',
      environment: {},
      inputBase64: null,
      deadlineMilliseconds: 1000,
    };
    const bodies = [
      {...complete, sessionLock: {path: '/tmp/lock', action: 'open'}},
      {...complete, sessionLock: {path: '/tmp/lock', action: 'release'}},
      complete,
    ];
    deepStrictEqual(
      bodies.map(body => readConnectionRequest(body)),
      bodies,
    );
  });

  it('F-2408 BR-4: reads nothing from a script request whose session lock has no path, another action, or is not an object', () => {
    const complete = {
      type: 'runScript',
      runId: 1,
      script: 'x',
      environment: {},
      inputBase64: null,
      deadlineMilliseconds: 1000,
    };
    deepStrictEqual(
      [
        {path: '', action: 'open'},
        {path: '/tmp/lock', action: 'take'},
        {path: 5, action: 'open'},
        {action: 'open'},
        'open',
        null,
      ].map(sessionLock => readConnectionRequest({...complete, sessionLock})),
      [undefined, undefined, undefined, undefined, undefined, undefined],
    );
  });

  it('reads nothing from a script request that is incomplete or has no time to run', () => {
    const complete = {
      type: 'runScript',
      runId: 1,
      script: 'x',
      environment: {},
      inputBase64: null,
      deadlineMilliseconds: 1000,
    };
    deepStrictEqual(
      [
        {...complete, runId: '1'},
        {...complete, script: 1},
        {...complete, inputBase64: 5},
        {...complete, environment: {NAME: 1}},
        {...complete, environment: 'A=1'},
        {...complete, environment: null},
        {...complete, deadlineMilliseconds: '1'},
        {...complete, deadlineMilliseconds: 0},
      ].map(body => readConnectionRequest(body)),
      [
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
});
