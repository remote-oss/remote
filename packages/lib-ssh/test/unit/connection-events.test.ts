import {deepStrictEqual} from 'node:assert';
import type {PlainData} from 'lib-helper';
import {readConnectionEvent, readConnectionReply} from '../../src/index.ts';

const RECORD = {
  remotePort: 41000,
  operatingSystem: 'linux',
  architecture: 'x64',
  temporaryFolder: '/tmp',
  connectionToken: 'token-value',
};

const REPLIES: PlainData[] = [
  {type: 'accepted'},
  {type: 'refused', reason: 'notOwner'},
  {type: 'sharedRecord', record: null},
  {type: 'sharedRecord', record: RECORD},
  {type: 'answered', accepted: true},
  {type: 'scriptEnded', status: 3},
  {type: 'scriptFailed', reason: 'timeout', detail: 'no end in time'},
];

const EVENTS: PlainData[] = [
  {type: 'prompt', promptId: 2, surface: 'maskedInput', text: 'pw: '},
  {type: 'promptClosed', promptId: 2},
  {type: 'ownerChanged', owner: 3},
  {type: 'waitingForOtherWindow'},
  {type: 'connected', socksPort: 41000},
  {type: 'transportLost'},
  {type: 'scriptLine', runId: 4, line: 'hello'},
  {type: 'spawnFailed', cause: 'clientVanished', detail: 'spawn ssh ENOENT'},
  {type: 'loginFailed', kind: 'unknown', hints: []},
  {
    type: 'loginFailed',
    kind: 'authentication',
    reason: {text: 'Permission denied.'},
    hints: [],
  },
];

describe('connection replies and events (contracts §4 S9)', () => {
  it('reads the replies of the helper', () => {
    deepStrictEqual(
      REPLIES.map(body => readConnectionReply(body)),
      REPLIES,
    );
  });

  it('reads nothing from a body that is no reply', () => {
    deepStrictEqual(
      [
        null,
        'accepted',
        {type: 'other'},
        {type: 'refused', reason: 'because'},
        {type: 'refused'},
        {type: 'sharedRecord', record: {remotePort: 'x'}},
        {type: 'answered', accepted: 'yes'},
        {type: 'scriptEnded', status: 'ok'},
        {type: 'scriptFailed', reason: 'because', detail: 'x'},
        {type: 'scriptFailed', reason: 'timeout'},
      ].map(body => readConnectionReply(body)),
      Array.from({length: 10}, () => undefined),
    );
  });

  it('reads the events of the helper', () => {
    deepStrictEqual(
      EVENTS.map(body => readConnectionEvent(body)),
      EVENTS,
    );
  });

  it('connect-64: a loginFailed event with and without the exit status', () => {
    const failed = {type: 'loginFailed', kind: 'unknown', hints: []};
    deepStrictEqual(
      [
        {...failed, exitStatus: 255},
        {...failed, exitStatus: null},
        failed,
        {...failed, exitStatus: 'x'},
      ].map(body => readConnectionEvent(body)),
      [
        {...failed, exitStatus: 255},
        {...failed, exitStatus: null},
        failed,
        undefined,
      ],
    );
  });

  it('F-2003 BR-6 item 6: an sshLines event holds the lines as text, and nothing else', () => {
    deepStrictEqual(
      [
        {type: 'sshLines', lines: ['a', 'b']},
        {type: 'sshLines', lines: []},
        {type: 'sshLines', lines: ['a', 1]},
        {type: 'sshLines', lines: 'a'},
        {type: 'sshLines'},
      ].map(body => readConnectionEvent(body)),
      [
        {type: 'sshLines', lines: ['a', 'b']},
        {type: 'sshLines', lines: []},
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('reads nothing from a body that is no event', () => {
    deepStrictEqual(
      [
        [],
        {type: 'other'},
        {type: 'prompt', promptId: 1, surface: 'dialog', text: 'x'},
        {type: 'prompt', promptId: '1', surface: 'maskedInput', text: 'x'},
        {type: 'promptClosed'},
        {type: 'ownerChanged', owner: 'x'},
        {type: 'connected', socksPort: '1'},
        {type: 'loginFailed', kind: 'unknown'},
        {type: 'loginFailed', hints: []},
        {type: 'spawnFailed', cause: 'other', detail: 'x'},
        {type: 'spawnFailed', cause: 'spawnFailed'},
        {type: 'scriptLine', runId: 'x', line: 'y'},
        {type: 'scriptLine', runId: 1},
      ].map(body => readConnectionEvent(body)),
      Array.from({length: 13}, () => undefined),
    );
  });
});
