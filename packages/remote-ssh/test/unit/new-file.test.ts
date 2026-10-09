/**
 * @fileoverview Creating a picked SSH configuration file (card ssh-12): the folders and the file with their
 * modes, and the starter template with its tab stops.
 */

import {Buffer} from 'node:buffer';
import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  planCreation,
  starterTemplate,
  type CreationStep,
  type NewFileInput,
  type TabStop,
} from '../../src/config/new-file.ts';

/** The input a row sets, over a missing user file with nothing missing on its path. */
function input(changes: Partial<NewFileInput>): NewFileInput {
  return {
    file: '/h/.ssh/config',
    role: 'user',
    exists: false,
    missingFolders: [],
    ...changes,
  };
}

describe('planCreation (what to create for a picked file)', () => {
  it('F-2203.BR-5: a missing user file with a missing folder, the folder then the file', () => {
    const steps: readonly CreationStep[] = [
      {path: '/h/.ssh', kind: 'folder', mode: 0o700},
      {path: '/h/.ssh/config', kind: 'file', mode: 0o600},
    ];
    deepStrictEqual(
      planCreation(
        input({file: '/h/.ssh/config', missingFolders: ['/h/.ssh']}),
      ),
      {steps, insertTemplate: true},
    );
  });

  it('F-2203.AC-31: a missing user file with an existing folder, only the file step', () => {
    deepStrictEqual(planCreation(input({role: 'user'})), {
      steps: [{path: '/h/.ssh/config', kind: 'file', mode: 0o600}],
      insertTemplate: true,
    });
  });

  it('F-2203.AC-9: an existing file, no steps and no template', () => {
    deepStrictEqual(
      planCreation(
        input({
          role: 'configured',
          exists: true,
          missingFolders: ['/a'],
        }),
      ),
      {steps: [], insertTemplate: false},
    );
  });

  it('F-2203.AC-12: a missing configured file with two missing folders, both then the file', () => {
    deepStrictEqual(
      planCreation(
        input({
          role: 'configured',
          file: '/a/b/config',
          missingFolders: ['/a', '/a/b'],
        }),
      ),
      {
        steps: [
          {path: '/a', kind: 'folder', mode: 0o755},
          {path: '/a/b', kind: 'folder', mode: 0o755},
          {path: '/a/b/config', kind: 'file', mode: 0o644},
        ],
        insertTemplate: true,
      },
    );
  });

  it('F-2203.BR-5: a missing configured file alone, the file in the configured mode', () => {
    deepStrictEqual(planCreation(input({role: 'configured'})), {
      steps: [{path: '/h/.ssh/config', kind: 'file', mode: 0o644}],
      insertTemplate: true,
    });
  });
});

describe('starterTemplate (the lines and tab stops of the new file)', () => {
  it('F-2203.AC-6: a four-space indent, the four lines joined, no trailing newline', () => {
    deepStrictEqual(
      starterTemplate({insertSpaces: true, tabSize: 4}).text,
      '# Read more about SSH config files: https://linux.die.net/man/5/ssh_config\n' +
        'Host alias\n' +
        '    HostName hostname\n' +
        '    User user',
    );
  });

  it('F-2203.AC-7: the four-space text is 121 bytes', () => {
    strictEqual(
      Buffer.byteLength(starterTemplate({insertSpaces: true, tabSize: 4}).text),
      121,
    );
  });

  it('F-2203.AC-25: two tabs of indent, the option lines start with two tabs', () => {
    const [, , option1, option2] = starterTemplate({
      insertSpaces: false,
      tabSize: 2,
    }).text.split('\n');
    deepStrictEqual(
      [option1?.slice(0, 2), option2?.slice(0, 2)],
      ['\t\t', '\t\t'],
    );
  });

  it('F-2203.AC-25: spaces of indent, the option lines start with four spaces', () => {
    const [, , option1, option2] = starterTemplate({
      insertSpaces: true,
      tabSize: 2,
    }).text.split('\n');
    deepStrictEqual(
      [option1?.slice(0, 4), option2?.slice(0, 4)],
      ['    ', '    '],
    );
  });

  it('F-2203.BR-6: four of indent, the option lines start with one tab', () => {
    const [, , option1, option2] = starterTemplate({
      insertSpaces: false,
      tabSize: 4,
    }).text.split('\n');
    deepStrictEqual([option1?.slice(0, 1), option2?.slice(0, 1)], ['\t', '\t']);
  });

  it('F-2203.AC-6: the four-space template tab stops', () => {
    const stops: readonly TabStop[] = [
      {line: 1, start: 5, end: 10},
      {line: 2, start: 13, end: 21},
      {line: 3, start: 9, end: 13},
      {line: 3, start: 13, end: 13},
    ];
    deepStrictEqual(
      starterTemplate({insertSpaces: true, tabSize: 4}).tabStops,
      stops,
    );
  });

  it('F-2203.BR-6: the two-tab template tab stops', () => {
    deepStrictEqual(
      starterTemplate({insertSpaces: false, tabSize: 2}).tabStops,
      [
        {line: 1, start: 5, end: 10},
        {line: 2, start: 11, end: 19},
        {line: 3, start: 7, end: 11},
        {line: 3, start: 11, end: 11},
      ],
    );
  });
});
