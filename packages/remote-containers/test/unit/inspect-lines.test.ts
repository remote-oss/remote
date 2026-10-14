/* eslint-disable id-length -- the field names of Docker's inspect output */
import {deepStrictEqual} from 'node:assert';
import {
  hasVscodeVolume,
  inspectedFacts,
} from '../../src/lifecycle/inspect-lines.ts';

const CONTAINER_ID =
  '93e50db9eb557e3e41b368f995b518456d3e85800a6e16a8414db40c41c11b90';

/** The sample of `docker inspect` of the card's appendix, with the mount of the volume `name` at `destination`. */
function sample(
  mount: {Type: string; Name: string; Destination: string} = {
    Type: 'volume',
    Name: 'vscode',
    Destination: '/vscode',
  },
): string {
  return JSON.stringify([
    {
      Id: CONTAINER_ID,
      Created: '2026-10-14T03:00:28.107239685Z',
      State: {Status: 'running'},
      Config: {
        Labels: {
          'devcontainer.config_file':
            '/w/ws,a b/.devcontainer/devcontainer.json',
          'devcontainer.local_folder': '/w/ws,a b',
          'devcontainer.metadata': '[]',
        },
      },
      Mounts: [
        mount,
        {Type: 'bind', Source: '/w/ws,a b', Destination: '/workspaces/ws,a b'},
      ],
    },
  ]);
}

describe('the reading of docker inspect', () => {
  it('C7: the sample gives one container, with a label value holding a comma and a space whole', () => {
    deepStrictEqual(inspectedFacts(sample()), {
      kind: 'facts',
      containers: [
        {
          id: CONTAINER_ID,
          created: '2026-10-14T03:00:28.107239685Z',
          status: 'running',
          labels: {
            'devcontainer.config_file':
              '/w/ws,a b/.devcontainer/devcontainer.json',
            'devcontainer.local_folder': '/w/ws,a b',
            'devcontainer.metadata': '[]',
          },
        },
      ],
    });
  });

  it('C7: an empty list gives no container', () => {
    deepStrictEqual(inspectedFacts('[]'), {kind: 'facts', containers: []});
  });

  for (const [name, text, detail] of [
    [
      'a missing State.Status',
      JSON.stringify([
        {Id: 'a', Created: 'b', State: {}, Config: {Labels: {}}},
      ]),
      'inspect: State.Status',
    ],
    ['a missing Id', JSON.stringify([{}]), 'inspect: Id'],
    ['a missing Created', JSON.stringify([{Id: 'a'}]), 'inspect: Created'],
    [
      'labels that are not strings',
      JSON.stringify([
        {Id: 'a', Created: 'b', State: {Status: 'x'}, Config: {Labels: {k: 1}}},
      ]),
      'inspect: Config.Labels',
    ],
    ['an element that is not an object', JSON.stringify([3]), 'inspect: Id'],
    ['text that is not JSON', 'not json', 'inspect: not JSON'],
    ['a JSON value that is not a list', '{}', 'inspect: not a list'],
  ] as const) {
    it(`C7: ${name} is a failed discovery naming it`, () => {
      deepStrictEqual(inspectedFacts(text), {kind: 'discoveryFailed', detail});
    });
  }

  it('F-0419 AC-1: the volume vscode at /vscode is mounted', () => {
    deepStrictEqual(hasVscodeVolume(sample()), true);
  });

  for (const mount of [
    {Type: 'volume', Name: 'vscode2', Destination: '/vscode'},
    {Type: 'volume', Name: 'vscode', Destination: '/vsc'},
    {Type: 'bind', Name: 'vscode', Destination: '/vscode'},
  ]) {
    it(`F-0419 AC-1: ${JSON.stringify(mount)} is not the volume`, () => {
      deepStrictEqual(hasVscodeVolume(sample(mount)), false);
    });
  }

  it('F-0419 AC-1: text that is not JSON, an empty list, an object and a container with no mounts are not the volume', () => {
    deepStrictEqual(
      [
        hasVscodeVolume('nope'),
        hasVscodeVolume('[]'),
        hasVscodeVolume('{}'),
        hasVscodeVolume(JSON.stringify([{}])),
      ],
      [false, false, false, false],
    );
  });
});
