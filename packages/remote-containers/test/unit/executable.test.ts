import {deepStrictEqual} from 'node:assert';
import {executableOf} from '../../src/engine/executable.ts';

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
