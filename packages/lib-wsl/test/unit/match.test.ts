/**
 * @fileoverview The match of a typed distribution name against the registered rows, and the hiding of the
 * Docker Desktop distros (card wsl-04).
 */

import {deepStrictEqual} from 'node:assert';
import {
  filterDockerDesktop,
  matchDistro,
  type DistroRow,
} from '../../src/index.ts';

/** The rows of the card's table: Ubuntu as the default, Debian plain, Legacy at version 1, a non-ASCII name. */
const rows: readonly DistroRow[] = Object.freeze([
  {name: 'Ubuntu', isDefault: true, state: 'running', version: 2},
  {name: 'Debian', isDefault: false, state: 'stopped', version: 2},
  {name: 'Legacy', isDefault: false, state: 'stopped', version: 1},
  {name: 'fixture γ', isDefault: false, state: 'running', version: 2},
]);

/** The rows without a default marker. */
const noDefault: readonly DistroRow[] = Object.freeze([
  {name: 'Debian', isDefault: false, state: 'stopped', version: 2},
]);

/** Two rows whose names differ only in case. */
const twins: readonly DistroRow[] = Object.freeze([
  {name: 'Dup', isDefault: false, state: 'stopped', version: 2},
  {name: 'dup', isDefault: false, state: 'stopped', version: 2},
]);

/** The Docker Desktop distros among a registered one. */
const docker: readonly DistroRow[] = Object.freeze([
  {name: 'docker-desktop', isDefault: false, state: 'running', version: 2},
  {name: 'Ubuntu', isDefault: true, state: 'running', version: 2},
  {
    name: 'docker-desktop-data',
    isDefault: false,
    state: 'running',
    version: 2,
  },
]);

/** One Docker Desktop distro in another case. */
const otherCase: readonly DistroRow[] = Object.freeze([
  {name: 'Docker-Desktop', isDefault: false, state: 'running', version: 2},
  {name: 'Ubuntu', isDefault: true, state: 'running', version: 2},
]);

/** Names that only contain the Docker Desktop words. */
const keepers: readonly DistroRow[] = Object.freeze([
  {
    name: 'docker-desktop-extra',
    isDefault: false,
    state: 'stopped',
    version: 2,
  },
  {name: 'my-docker-desktop', isDefault: false, state: 'stopped', version: 2},
]);

/** The empty list. */
const empty: readonly DistroRow[] = Object.freeze([]);

describe('matchDistro (card wsl-04)', () => {
  it('F-6201.BR-1: an exact name is the match, with its version and default', () => {
    deepStrictEqual(matchDistro(rows, 'Ubuntu'), {
      kind: 'match',
      registeredName: 'Ubuntu',
      version: 2,
      isDefault: true,
    });
  });

  it('F-6201.BR-1: lower and upper case give the registered spelling', () => {
    deepStrictEqual(
      [matchDistro(rows, 'ubuntu'), matchDistro(rows, 'UBUNTU')].map(result =>
        result.kind === 'match' ? result.registeredName : result,
      ),
      ['Ubuntu', 'Ubuntu'],
    );
  });

  it('F-6201.BR-1: a lower-cased name of a non-default row is the match', () => {
    deepStrictEqual(matchDistro(rows, 'legacy'), {
      kind: 'match',
      registeredName: 'Legacy',
      version: 1,
      isDefault: false,
    });
  });

  it('F-6201.BR-1: a non-ASCII name folds to the registered row', () => {
    deepStrictEqual(matchDistro(rows, 'FIXTURE Γ'), {
      kind: 'match',
      registeredName: 'fixture γ',
      version: 2,
      isDefault: false,
    });
  });

  it('F-6201.BR-1: an exactly typed name wins over its case-folded twin', () => {
    deepStrictEqual(matchDistro(twins, 'Dup'), {
      kind: 'match',
      registeredName: 'Dup',
      version: 2,
      isDefault: false,
    });
  });

  it('F-6201.BR-1 (provisional): names that differ only in case are distroUnknown', () => {
    deepStrictEqual(matchDistro(twins, 'DUP'), {
      kind: 'distroUnknown',
      asTyped: 'DUP',
    });
  });

  it('F-6201 6.8: an empty name is the default row', () => {
    deepStrictEqual(matchDistro(rows, ''), {
      kind: 'match',
      registeredName: 'Ubuntu',
      version: 2,
      isDefault: true,
    });
  });

  it('F-6201 6.8: an empty name without a default row is no distro', () => {
    deepStrictEqual(matchDistro(noDefault, ''), {kind: 'noDistro'});
  });

  it('F-6201 7.E1: an unknown name is distroUnknown, as typed', () => {
    deepStrictEqual(matchDistro(rows, 'nosuch'), {
      kind: 'distroUnknown',
      asTyped: 'nosuch',
    });
  });

  it('F-6201 7.E1: an unknown name with a trailing space stays as typed', () => {
    deepStrictEqual(matchDistro(rows, 'NoSuch '), {
      kind: 'distroUnknown',
      asTyped: 'NoSuch ',
    });
  });

  it('F-6201 7.E1: a blank name is distroUnknown', () => {
    deepStrictEqual(matchDistro(rows, ' '), {
      kind: 'distroUnknown',
      asTyped: ' ',
    });
  });

  it('F-6201 7.E1: an empty list with a name is distroUnknown', () => {
    deepStrictEqual(matchDistro(empty, 'Ubuntu'), {
      kind: 'distroUnknown',
      asTyped: 'Ubuntu',
    });
  });
});

describe('filterDockerDesktop (card wsl-04)', () => {
  it('F-6701.BR-3: both Docker Desktop distros are hidden, the rest in order', () => {
    deepStrictEqual(filterDockerDesktop(docker, false), [
      {name: 'Ubuntu', isDefault: true, state: 'running', version: 2},
    ]);
  });

  it('F-6701.BR-3: including them keeps the rows', () => {
    deepStrictEqual(filterDockerDesktop(docker, true), docker);
  });

  it('F-6701.BR-3: a Docker Desktop distro in another case is hidden', () => {
    deepStrictEqual(filterDockerDesktop(otherCase, false), [
      {name: 'Ubuntu', isDefault: true, state: 'running', version: 2},
    ]);
  });

  it('F-6701.BR-3: names that only contain the words are kept', () => {
    deepStrictEqual(filterDockerDesktop(keepers, false), keepers);
  });
});
