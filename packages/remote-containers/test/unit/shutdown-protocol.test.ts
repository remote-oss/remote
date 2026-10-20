import {deepStrictEqual} from 'node:assert';
import {readShutdownRequest} from '../../src/shutdown/protocol.ts';

const IDENTITY = {
  hostPath: '/home/user/proj',
  configFile: '/home/user/proj/.devcontainer/devcontainer.json',
};

describe('the shutdown helper’s messages (card containers-68)', () => {
  it('F-0417 BR-13: a register names the connection, the container’s identity and the engine’s coordinates', () => {
    deepStrictEqual(
      readShutdownRequest({
        type: 'register',
        connectionId: 'c1',
        identity: IDENTITY,
        engine: {
          dockerPath: '/usr/bin/docker',
          environment: {DOCKER_CONTEXT: 'remote'},
        },
      }),
      {
        kind: 'request',
        request: {
          type: 'register',
          connectionId: 'c1',
          identity: IDENTITY,
          engine: {
            dockerPath: '/usr/bin/docker',
            environment: {DOCKER_CONTEXT: 'remote'},
          },
        },
      },
    );
  });

  it('F-0417 BR-13: an engine with no environment member has an empty one', () => {
    deepStrictEqual(
      readShutdownRequest({
        type: 'register',
        connectionId: 'c1',
        identity: IDENTITY,
        engine: {dockerPath: 'docker'},
      }),
      {
        kind: 'request',
        request: {
          type: 'register',
          connectionId: 'c1',
          identity: IDENTITY,
          engine: {dockerPath: 'docker', environment: {}},
        },
      },
    );
  });

  it('F-0417 BR-8: a container message and a leave carry their own members', () => {
    deepStrictEqual(
      [
        readShutdownRequest({
          type: 'container',
          connectionId: 'c1',
          containerId: 'abc',
          action: 'none',
        }),
        readShutdownRequest({type: 'leave', connectionId: 'c1'}),
      ],
      [
        {
          kind: 'request',
          request: {
            type: 'container',
            connectionId: 'c1',
            containerId: 'abc',
            action: 'none',
          },
        },
        {kind: 'request', request: {type: 'leave', connectionId: 'c1'}},
      ],
    );
  });

  it('F-0417 BR-11: a message that is none of these gives its problem', () => {
    const register = {
      type: 'register',
      connectionId: 'c1',
      identity: IDENTITY,
      engine: {dockerPath: 'docker'},
    };
    deepStrictEqual(
      [
        readShutdownRequest('text'),
        readShutdownRequest([1]),
        readShutdownRequest({type: 'leave'}),
        readShutdownRequest({type: 'leave', connectionId: ''}),
        readShutdownRequest({type: 'stop', connectionId: 'c1'}),
        readShutdownRequest({...register, identity: {hostPath: '/a'}}),
        readShutdownRequest({...register, identity: 'x'}),
        readShutdownRequest({...register, engine: {environment: {}}}),
        readShutdownRequest({...register, engine: 'x'}),
        readShutdownRequest({
          ...register,
          engine: {dockerPath: 'docker', environment: {DOCKER_HOST: 1}},
        }),
        readShutdownRequest({
          ...register,
          engine: {dockerPath: 'docker', environment: [1]},
        }),
        readShutdownRequest({
          type: 'container',
          connectionId: 'c1',
          containerId: 'abc',
          action: 'halt',
        }),
        readShutdownRequest({
          type: 'container',
          connectionId: 'c1',
          action: 'stop',
        }),
      ].map(read => (read.kind === 'malformed' ? read.problem : 'a request')),
      [
        'the message is not an object',
        'the message is not an object',
        'the message has no connectionId',
        'the message has no connectionId',
        'the message type is unknown',
        'register needs the identity with a hostPath and a configFile',
        'register needs the identity with a hostPath and a configFile',
        'register needs the engine with a dockerPath and an environment of text',
        'register needs the engine with a dockerPath and an environment of text',
        'register needs the engine with a dockerPath and an environment of text',
        'register needs the engine with a dockerPath and an environment of text',
        'container needs a containerId and an action of stop or none',
        'container needs a containerId and an action of stop or none',
      ],
    );
  });
});
