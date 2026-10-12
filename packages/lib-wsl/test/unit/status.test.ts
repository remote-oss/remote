import {deepStrictEqual} from 'node:assert';
import {parseStatus} from '../../src/index.ts';

describe('parseStatus', () => {
  it('D1a: reads the default distribution and version', () => {
    deepStrictEqual(
      parseStatus('Default Distribution: Ubuntu\nDefault Version: 2'),
      {defaultDistro: 'Ubuntu', defaultVersion: 2},
    );
  });

  it('D1a: reads the WSL and kernel versions and ignores the others', () => {
    deepStrictEqual(
      parseStatus(
        'WSL version: 2.1.5.0\nKernel version: 5.15.146.1-2\nWSLg version: 1.0.61',
      ),
      {wslVersion: '2.1.5.0', kernelVersion: '5.15.146.1-2'},
    );
  });

  it('D1a: a version other than 1 or 2 and an empty value stay absent', () => {
    deepStrictEqual(
      parseStatus('Default Version: 3\nDefault Distribution:'),
      {},
    );
  });

  it('D1a: reads version 1', () => {
    deepStrictEqual(parseStatus('Default Version: 1'), {defaultVersion: 1});
  });

  it('D1a: ignores the case of a label', () => {
    deepStrictEqual(parseStatus('DEFAULT DISTRIBUTION: Ubuntu'), {
      defaultDistro: 'Ubuntu',
    });
  });

  it('D1a: the first line of a label wins', () => {
    deepStrictEqual(
      parseStatus('Default Distribution: First\nDefault Distribution: Second'),
      {defaultDistro: 'First'},
    );
  });

  it('D1a: a value keeps a colon of its own', () => {
    deepStrictEqual(parseStatus('Default Distribution: a:b'), {
      defaultDistro: 'a:b',
    });
  });

  it('D1a: a line without a colon is ignored, and CRLF ends are read', () => {
    deepStrictEqual(
      parseStatus('no colon here\r\nDefault Distribution: Ubuntu\r\n'),
      {defaultDistro: 'Ubuntu'},
    );
  });

  it('D1a: labels that are names of Object members give nothing', () => {
    deepStrictEqual(
      parseStatus(
        '__proto__: x\nconstructor: abc\ntoString: y\nhasOwnProperty: z',
      ),
      {},
    );
  });

  it('D1a: localised labels and empty text give nothing', () => {
    deepStrictEqual(
      [parseStatus('Standarddistribution: Ubuntu'), parseStatus('')],
      [{}, {}],
    );
  });
});
