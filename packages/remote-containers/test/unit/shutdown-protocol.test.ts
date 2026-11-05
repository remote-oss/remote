import {deepStrictEqual} from 'node:assert';
import {
  identityFilters,
  identityLabel,
  readShutdownRequest,
  sameIdentity,
} from '../../src/shutdown/protocol.ts';

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

  it('F-0417 BR-4: a compose message carries the project, the primary service and the scope', () => {
    deepStrictEqual(
      readShutdownRequest({
        type: 'compose',
        connectionId: 'c1',
        compose: {project: 'proj', service: 'app', scope: ['app', 'db']},
      }),
      {
        kind: 'request',
        request: {
          type: 'compose',
          connectionId: 'c1',
          compose: {project: 'proj', service: 'app', scope: ['app', 'db']},
        },
      },
    );
  });

  it('F-0417 BR-11: a compose message without its project, its service or a scope of names gives its problem', () => {
    const member = {project: 'proj', service: 'app', scope: ['app']};
    const compose = {type: 'compose', connectionId: 'c1', compose: member};
    const problem = {
      kind: 'malformed',
      problem:
        'compose needs a project, a service and a scope of service names',
    };
    deepStrictEqual(
      [
        {...compose, compose: {...member, project: ''}},
        {...compose, compose: {...member, service: undefined}},
        {...compose, compose: {...member, scope: 'app'}},
        {...compose, compose: {...member, scope: ['app', '']}},
        {...compose, compose: {...member, scope: [1]}},
        {...compose, compose: 'proj'},
        {type: 'compose', connectionId: 'c1'},
      ].map(readShutdownRequest),
      Array(7).fill(problem),
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
        readShutdownRequest({...register, identity: {volumeName: 'v'}}),
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
        'register needs the identity with a hostPath and a configFile, a volumeName and a folder, or a volumeName and a configFile',
        'register needs the identity with a hostPath and a configFile, a volumeName and a folder, or a volumeName and a configFile',
        'register needs the identity with a hostPath and a configFile, a volumeName and a folder, or a volumeName and a configFile',
        'register needs the engine with a dockerPath and an environment of text',
        'register needs the engine with a dockerPath and an environment of text',
        'register needs the engine with a dockerPath and an environment of text',
        'register needs the engine with a dockerPath and an environment of text',
        'container needs a containerId and an action of stop or none',
        'container needs a containerId and an action of stop or none',
      ],
    );
  });

  it('brief-volumes §7 (card containers-151): a register for a clone in a volume names the volume and the folder', () => {
    deepStrictEqual(
      readShutdownRequest({
        type: 'register',
        connectionId: 'c1',
        identity: {volumeName: 'r-1', folder: 'r'},
        engine: {dockerPath: 'docker'},
      }),
      {
        kind: 'request',
        request: {
          type: 'register',
          connectionId: 'c1',
          identity: {volumeName: 'r-1', folder: 'r'},
          engine: {dockerPath: 'docker', environment: {}},
        },
      },
    );
  });

  it('F-0705 BR-7 (card containers-155): a register for an explored volume names the volume and the shared definition’s configuration, and one with only a volume is malformed', () => {
    const register = {
      type: 'register',
      connectionId: 'c1',
      engine: {dockerPath: 'docker'},
    };
    deepStrictEqual(
      [
        readShutdownRequest({
          ...register,
          identity: {volumeName: 'data', configFile: '/t/devcontainer.json'},
        }),
        readShutdownRequest({...register, identity: {volumeName: 'data'}}),
      ],
      [
        {
          kind: 'request',
          request: {
            type: 'register',
            connectionId: 'c1',
            identity: {volumeName: 'data', configFile: '/t/devcontainer.json'},
            engine: {dockerPath: 'docker', environment: {}},
          },
        },
        {
          kind: 'malformed',
          problem:
            'register needs the identity with a hostPath and a configFile, a volumeName and a folder, or a volumeName and a configFile',
        },
      ],
    );
  });

  it('F-0417 AC-14 (c163-attached-identity): a register for an attached container names the container, and says it does not own with owning false', () => {
    const engine = {dockerPath: 'docker', environment: {}};
    function register(owning?: unknown): unknown {
      return readShutdownRequest({
        type: 'register',
        connectionId: 'c1',
        identity: {containerName: 'web'},
        engine,
        ...(owning === undefined ? {} : {owning}),
      });
    }
    deepStrictEqual(
      [register(), register(false), register(true), register('no')],
      [
        {
          kind: 'request',
          request: {
            type: 'register',
            connectionId: 'c1',
            identity: {containerName: 'web'},
            engine,
          },
        },
        {
          kind: 'request',
          request: {
            type: 'register',
            connectionId: 'c1',
            identity: {containerName: 'web'},
            engine,
            owning: false,
          },
        },
        {
          kind: 'request',
          request: {
            type: 'register',
            connectionId: 'c1',
            identity: {containerName: 'web'},
            engine,
          },
        },
        {kind: 'malformed', problem: 'register needs owning to be a boolean'},
      ],
    );
  });

  it('F-0417 AC-14 (c163-attached-names): an attached container’s identity is told by its name, labelled and found by it', () => {
    const left = {containerName: 'web'};
    deepStrictEqual(
      [
        sameIdentity(left, {containerName: 'web'}),
        sameIdentity(left, {containerName: 'db'}),
        sameIdentity(left, {volumeName: 'web', folder: 'web'}),
        identityLabel(left),
        identityFilters(left),
      ],
      [true, false, false, 'the container web', ['--filter', 'name=^/web$']],
    );
  });
});
