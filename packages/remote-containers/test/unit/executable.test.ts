import {deepStrictEqual} from 'node:assert';
import {engineBaseOf, executableOf} from '../../src/engine/executable.ts';

describe('the executable of dev.containers.dockerPath', () => {
  for (const [value, base, expected] of [
    ['docker', undefined, {kind: 'spawn', file: 'docker'}],
    ['/usr/bin/docker', undefined, {kind: 'spawn', file: '/usr/bin/docker'}],
    ['tools/dk', '/w', {kind: 'spawn', file: '/w/tools/dk'}],
    ['./tools/dk', '/w', {kind: 'spawn', file: '/w/tools/dk'}],
    ['tools/dk', undefined, {kind: 'notFound'}],
    ['~/bin/dk', undefined, {kind: 'spawn', file: '~/bin/dk'}],
    ['$HOME/bin/dk', undefined, {kind: 'spawn', file: '$HOME/bin/dk'}],
    [
      '/usr/bin/docker --debug',
      undefined,
      {kind: 'spawn', file: '/usr/bin/docker --debug'},
    ],
    ['', undefined, {kind: 'spawn', file: 'docker'}],
    [5, undefined, {kind: 'spawn', file: 'docker'}],
  ] as const) {
    it(`F-0201 BR-1: ${JSON.stringify(value)} with base ${String(base)} is ${JSON.stringify(expected)}`, () => {
      const written =
        typeof value === 'string' && value !== '' ? value : 'docker';
      deepStrictEqual(executableOf(value, base), {...expected, written});
    });
  }
});

describe('the base of a relative dockerPath (card containers-142, F-0201 AC-55)', () => {
  it('F-0201 AC-55: the window’s first folder is the base only once the window is trusted, and a relative value then names a program only then', () => {
    const folder = '/work/proj';
    deepStrictEqual(
      [
        engineBaseOf({folder, trusted: true}),
        engineBaseOf({folder, trusted: false}),
        engineBaseOf({folder: undefined, trusted: true}),
        executableOf('tools/dk', engineBaseOf({folder, trusted: false})).kind,
        executableOf('tools/dk', engineBaseOf({folder, trusted: true})).kind,
        executableOf('/opt/docker', engineBaseOf({folder, trusted: false}))
          .kind,
        executableOf('docker', engineBaseOf({folder, trusted: false})).kind,
      ],
      [
        '/work/proj',
        undefined,
        undefined,
        'notFound',
        'spawn',
        'spawn',
        'spawn',
      ],
    );
  });
});

describe('the executable of dev.containers.dockerComposePath', () => {
  it('F-0201 AC-44: an empty or absent value names the default program given, and a written one is itself', () => {
    deepStrictEqual(
      [
        executableOf('', undefined, 'docker-compose'),
        executableOf(undefined, undefined, 'docker-compose'),
        executableOf('tools/dc', '/w', 'docker-compose'),
      ],
      [
        {kind: 'spawn', file: 'docker-compose', written: 'docker-compose'},
        {kind: 'spawn', file: 'docker-compose', written: 'docker-compose'},
        {kind: 'spawn', file: '/w/tools/dc', written: 'tools/dc'},
      ],
    );
  });
});
