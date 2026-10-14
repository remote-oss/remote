import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseAddHostCommand, writeHostBlock} from '../../src/index.ts';
import type {HostBlock} from '../../src/index.ts';

/** The block of the row's notation HOST_BLOCK: alias host4, the HostName line and the port. */
const HOST_BLOCK: HostBlock = {
  alias: 'host4',
  lines: [
    {keyword: 'HostName', value: 'host4'},
    {keyword: 'Port', value: '2222'},
  ],
};

/** The block's text with the row's indentation and line end. */
function blockText(
  hostIndent: string,
  optionIndent: string,
  lineEnd = '\n',
): string {
  const lines = [
    `${hostIndent}Host ${HOST_BLOCK.alias}`,
    ...HOST_BLOCK.lines.map(
      line => `${optionIndent}${line.keyword} ${line.value}`,
    ),
  ];
  return lines.map(line => `${line}${lineEnd}`).join('');
}

/** The file text with the block written into it. */
function write(fileText: string): string {
  return writeHostBlock(fileText, HOST_BLOCK);
}

describe('writeHostBlock (the file text with the block placed)', () => {
  it('F-2204.BR-11a: an empty file gains the block', () => {
    deepStrictEqual(write(''), blockText('', '  '));
  });

  it('F-2204.BR-11b: a block file gains the block first', () => {
    deepStrictEqual(
      write('Host old\n  HostName o\n'),
      `${blockText('', '  ')}\nHost old\n  HostName o\n`,
    );
  });

  it('F-2204 AC-17: BR-11b, the block goes before the first block, after the globals', () => {
    const file =
      '# top\nInclude x\nServerAliveInterval 5\n\nHost old\n  Port 1\n';
    deepStrictEqual(
      write(file),
      '# top\nInclude x\nServerAliveInterval 5\n\n' +
        `${blockText('', '  ')}\nHost old\n  Port 1\n`,
    );
  });

  it('F-2204.BR-11b: a Match line opens a block', () => {
    deepStrictEqual(
      write('Match all\n  X 1\n'),
      `${blockText('', '  ')}\nMatch all\n  X 1\n`,
    );
  });

  it('F-2204.BR-11b: a lower case host line opens a block', () => {
    deepStrictEqual(
      write('host a\n  X 1\n'),
      `${blockText('', '  ')}\nhost a\n  X 1\n`,
    );
  });

  it('F-2204.BR-11c: a globals-only file gains the block at the end', () => {
    deepStrictEqual(
      write('# only comments\nServerAliveInterval 5\n'),
      `# only comments\nServerAliveInterval 5\n\n${blockText('', '  ')}`,
    );
  });

  it('F-2204 AC-18: BR-11c, a file without a final newline gains one before the block', () => {
    deepStrictEqual(write('# c'), `# c\n\n${blockText('', '  ')}`);
  });

  it('F-2204 AC-18: BR-11c, a trailing blank line stays one', () => {
    deepStrictEqual(write('# c\n\n'), `# c\n\n${blockText('', '  ')}`);
  });

  it('F-2204.BR-11c: a global line that only starts like a block', () => {
    deepStrictEqual(
      write('HostName g\n'),
      `HostName g\n\n${blockText('', '  ')}`,
    );
  });

  it('F-2204.BR-12 (adapted): leading blank lines stay before the block', () => {
    deepStrictEqual(
      write('\n\nHost a\n  X 1\n'),
      `\n\n${blockText('', '  ')}\nHost a\n  X 1\n`,
    );
  });

  it('F-2204.BR-12 (adapted): a file without a final newline gains none after the file', () => {
    deepStrictEqual(
      write('Host a\n  X 1'),
      `${blockText('', '  ')}\nHost a\n  X 1`,
    );
  });

  it('F-2204.BR-12 (adapted): the block takes the file line end', () => {
    deepStrictEqual(
      write('Host a\r\n  X 1\r\n'),
      `${blockText('', '  ', '\r\n')}\r\nHost a\r\n  X 1\r\n`,
    );
  });

  it('F-2204.BR-12 (adapted): a globals-only file with the file line end', () => {
    deepStrictEqual(
      write('# c\r\n'),
      `# c\r\n\r\n${blockText('', '  ', '\r\n')}`,
    );
  });

  it('F-2204.BR-13: the block copies the indentation of the first block', () => {
    const file = 'Host a\nHostName x\n\nHost b\n    HostName y\n';
    deepStrictEqual(write(file), `${blockText('  ', '    ')}\n${file}`);
  });

  it('F-2204.BR-13: a comment line before the options gives the indentation', () => {
    const file = 'Host a\n      # note\nHostName x\n';
    deepStrictEqual(write(file), `${blockText('    ', '      ')}\n${file}`);
  });

  const INDENTED_FILES: Array<[string, string, string]> = [
    ['\t', '', 'a tab'],
    ['        ', '      ', 'eight spaces'],
    ['   ', ' ', 'three spaces'],
    ['  ', '', 'two spaces'],
  ];
  for (const [optionIndent, hostIndent, label] of INDENTED_FILES) {
    it(`F-2204.BR-13: options indented by ${label}`, () => {
      const file = `Host a\n${optionIndent}X 1\n`;
      deepStrictEqual(
        write(file),
        `${blockText(hostIndent, optionIndent)}\n${file}`,
      );
    });
  }

  it('F-2204.BR-13: an indentation before the first block does not count', () => {
    const file = '  Foo 1\nHost a\nHostName x\n';
    deepStrictEqual(
      write(file),
      `  Foo 1\n${blockText('', '  ')}\nHost a\nHostName x\n`,
    );
  });

  it('F-2204.BR-13: no option indentation copies the default', () => {
    const file = 'Host a\nHostName x\n';
    deepStrictEqual(write(file), `${blockText('', '  ')}\n${file}`);
  });

  it('F-2204 AC-20: BR-14, a duplicate host is written as it is', () => {
    deepStrictEqual(
      write('Host host4\n  HostName host4\n'),
      `${blockText('', '  ')}\nHost host4\n  HostName host4\n`,
    );
  });

  it('F-2204.BR-12 (adapted): an indented first line is not touched', () => {
    const file = '  Host a\n    X 1\n';
    deepStrictEqual(write(file), `${blockText('  ', '    ')}\n${file}`);
  });

  it('F-2204.BR-12 (provisional): a mixed line end file', () => {
    const file = 'Host a\r\n  X 1\n';
    deepStrictEqual(write(file), `${blockText('', '  ', '\r\n')}\r\n${file}`);
  });

  it('F-2204.BR-11c (provisional): a file of blank lines keeps them', () => {
    deepStrictEqual(write('\n\n'), `\n\n${blockText('', '  ')}`);
  });

  it('F-2204 AC-19: the new block copies the indentation of the file, or uses two spaces', () => {
    const files: Array<[string, string, string]> = [
      ['Host a\n    X 1\n', '  ', '    '],
      ['Host a\n\tX 1\n', '', '\t'],
      ['Host a\nHostName x\n\nHost b\n    HostName y\n', '  ', '    '],
      ['Host a\n      # note\nHostName x\n', '    ', '      '],
      ['Host a\nHostName x\n', '', '  '],
    ];
    deepStrictEqual(
      files.map(([file]) => write(file)),
      files.map(
        ([file, hostIndent, optionIndent]) =>
          `${blockText(hostIndent, optionIndent)}\n${file}`,
      ),
    );
  });

  it('F-2204 AC-37: ssh reads the written block of ssh -p 2222 -l bob h as host h, port 2222 and user bob', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'writer-'));
    try {
      const parsed = parseAddHostCommand('ssh -p 2222 -l bob h');
      if (!('block' in parsed)) {
        throw new Error(`no block for the row: ${JSON.stringify(parsed)}`);
      }
      const config = path.join(folder, 'config');
      writeFileSync(config, writeHostBlock('', parsed.block));
      const lookedUp = spawnSync('ssh', ['-G', '-F', config, 'h'], {
        encoding: 'utf8',
      });
      const lines = lookedUp.stdout
        .split('\n')
        .filter(
          line =>
            line.startsWith('hostname ') ||
            line.startsWith('port ') ||
            line.startsWith('user '),
        )
        .sort();
      deepStrictEqual(lines, ['hostname h', 'port 2222', 'user bob']);
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });
});
