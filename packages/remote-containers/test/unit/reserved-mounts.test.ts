import {deepStrictEqual} from 'node:assert';
import {
  isReservedTarget,
  mountTargetOf,
  reservedMount,
  runArgsTargets,
  serviceVolumeTargetOf,
} from '../../src/lifecycle/reserved-mounts.ts';

describe('the targets the cache volume reserves (F-0419 7.E3)', () => {
  it('F-0419 AC-20: /vscode and the paths below it are reserved, with or without trailing slashes', () => {
    deepStrictEqual(
      ['/vscode', '/vscode/', '/vscode//', '/vscode/x', '/vscode/x/y'].map(
        isReservedTarget,
      ),
      [true, true, true, true, true],
    );
  });

  it('F-0419 AC-21: a path that only starts with the same letters, or lies elsewhere, is not reserved', () => {
    deepStrictEqual(
      ['/vscodex', '/data', '/', '/a/vscode', 'vscode', ''].map(
        isReservedTarget,
      ),
      [false, false, false, false, false, false],
    );
  });

  it('F-0419 AC-20: a mounts entry gives its target in the string form with any of the three keys, in any case, and in the object form', () => {
    deepStrictEqual(
      [
        'type=volume,source=v,target=/vscode',
        'type=volume,source=v,dst=/vscode/a',
        'type=bind,source=/s,Destination=/vscode/b',
        'type=volume, TARGET = /d ',
        {type: 'volume', source: 'v', target: '/vscode'},
      ].map(mountTargetOf),
      ['/vscode', '/vscode/a', '/vscode/b', '/d', '/vscode'],
    );
  });

  it('F-0419 AC-20: a mounts entry with no target, or of another type, gives none', () => {
    deepStrictEqual(
      [
        'type=volume,source=v',
        'novalue',
        {source: 'v'},
        {target: 3},
        7,
        null,
      ].map(mountTargetOf),
      [undefined, undefined, undefined, undefined, undefined, undefined],
    );
  });

  it('F-0419 AC-20: a service volume gives its target in the short form with or without a mode, as a lone path, and in the long form', () => {
    deepStrictEqual(
      [
        'data:/vscode',
        '/host:/vscode/a:ro',
        '/vscode',
        {type: 'volume', source: 'v', target: '/vscode/b'},
        7,
      ].map(serviceVolumeTargetOf),
      ['/vscode', '/vscode/a', '/vscode', '/vscode/b', undefined],
    );
  });

  it('F-0419 AC-20: the first reserved target is found in the order of the sources, with its property', () => {
    deepStrictEqual(
      reservedMount([
        {property: 'mounts', targets: [undefined, '/data']},
        {property: 'services.app.volumes', targets: ['/x', '/vscode/y']},
        {property: 'runArgs', targets: ['/vscode']},
      ]),
      {property: 'services.app.volumes', target: '/vscode/y'},
    );
  });

  it('F-0419 AC-21: with no reserved target nothing is found', () => {
    deepStrictEqual(
      reservedMount([
        {property: 'mounts', targets: ['/data', undefined]},
        {property: 'services.app.volumes', targets: []},
      ]),
      undefined,
    );
  });

  it('F-0419 AC-23: runArgsTargets reads each spelling of the volume and mount options, in order', () => {
    deepStrictEqual(
      runArgsTargets([
        '-v',
        'data:/a:ro',
        '--volume',
        '/b',
        '--volume=src:/c',
        '--mount',
        'type=bind,source=/s,target=/d',
        '--mount=type=volume,dst=/e',
      ]),
      ['/a', '/b', '/c', '/d', '/e'],
    );
  });

  it('F-0419 AC-23: runArgsTargets skips a value-less option at the end, a value that is no string, a mount with no target and other options', () => {
    deepStrictEqual(
      runArgsTargets([
        '--rm',
        '-p',
        '80:80',
        '--mount',
        'type=tmpfs',
        '-v',
        7,
        '--mount=',
        42,
        '-v',
      ]),
      [],
    );
  });
});
