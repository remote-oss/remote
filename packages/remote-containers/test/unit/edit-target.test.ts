import {deepStrictEqual} from 'node:assert';
import type {Candidate} from '../../src/config/discovery.ts';
import {
  editTargetOf,
  type WindowEditFacts,
} from '../../src/config/edit-target.ts';

function main(root: string): Candidate {
  return {
    file: `${root}/.devcontainer/devcontainer.json`,
    relative: '.devcontainer/devcontainer.json',
    place: {kind: 'main'},
  };
}

function dotfile(root: string): Candidate {
  return {
    file: `${root}/.devcontainer.json`,
    relative: '.devcontainer.json',
    place: {kind: 'dotfile'},
  };
}

function stored(file: string): Candidate {
  return {file, relative: `~${file}`, place: {kind: 'stored', slot: 'slot-1'}};
}

const NONE: WindowEditFacts = {workspace: [], external: []};
const FILES = {name: '/s/nameConfigs/c.json', image: '/s/imageConfigs/i.json'};

describe('the target of an edit (card containers-206, F-0809 BR-7)', () => {
  it('F-0809 BR-7 (c206-target-attached): an attached container’s window gives the attach files, before anything else', () => {
    deepStrictEqual(
      editTargetOf({
        ...NONE,
        attached: FILES,
        ownFile: '/w/.devcontainer.json',
        workspace: [main('/w')],
      }),
      {kind: 'attach', files: FILES},
    );
  });

  it('F-0809 BR-7 (c206-target-own): the window’s own configuration is a buffer edit, before a recovery file or the folder’s candidates', () => {
    deepStrictEqual(
      editTargetOf({
        ...NONE,
        ownFile: '/w/.devcontainer/a/devcontainer.json',
        recoverySessionFile: '/s/recovery.json',
        workspace: [main('/w'), dotfile('/w')],
      }),
      {
        kind: 'file',
        file: '/w/.devcontainer/a/devcontainer.json',
        policy: 'buffer',
      },
    );
  });

  it('F-0809 BR-7 (c206-target-recovery): a Recovery Container’s session file is edited on disk unless it is open, before the folder’s candidates', () => {
    deepStrictEqual(
      editTargetOf({
        ...NONE,
        recoverySessionFile: '/s/recovery.json',
        workspace: [main('/w'), dotfile('/w')],
      }),
      {kind: 'file', file: '/s/recovery.json', policy: 'diskUnlessOpen'},
    );
  });

  it('F-0809 BR-7 (c206-target-pick): several configurations are picked from, each with its policy, in the owner’s order', () => {
    const local = [dotfile('/w'), main('/w')];
    const mirrored = stored('/a/store/devcontainer.json');
    deepStrictEqual(
      [
        editTargetOf({...NONE, workspace: local}),
        editTargetOf({...NONE, workspace: local, external: [mirrored]}),
      ],
      [
        {
          kind: 'pick',
          candidates: [
            {candidate: local[0], policy: 'buffer'},
            {candidate: local[1], policy: 'buffer'},
          ],
        },
        {
          kind: 'pick',
          candidates: [
            {candidate: mirrored, policy: 'diskUnlessOpen'},
            {candidate: local[0], policy: 'buffer'},
            {candidate: local[1], policy: 'buffer'},
          ],
        },
      ],
    );
  });

  it('F-0809 BR-7 (c206-target-single): a single configuration is the target: a stored or mirrored one on disk unless open, a workspace one in the buffer', () => {
    const single = stored('/store/devcontainer.json');
    deepStrictEqual(
      [
        editTargetOf({...NONE, external: [single]}),
        editTargetOf({...NONE, workspace: [main('/w')]}),
      ],
      [
        {kind: 'file', file: single.file, policy: 'diskUnlessOpen'},
        {
          kind: 'file',
          file: '/w/.devcontainer/devcontainer.json',
          policy: 'buffer',
        },
      ],
    );
  });

  it('F-0809 BR-7 (c206-target-none): no configuration anywhere is none', () => {
    deepStrictEqual(editTargetOf(NONE), {kind: 'none'});
  });
});
