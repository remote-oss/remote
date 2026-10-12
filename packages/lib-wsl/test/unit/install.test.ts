import {deepStrictEqual} from 'node:assert';
import {installCommandLine, sortOnlineCatalogue} from '../../src/index.ts';

function rowNamed(friendlyName: string, name = friendlyName) {
  return {name, friendlyName};
}

function friendlyNamesOf(friendlyNames: readonly string[]): readonly string[] {
  return sortOnlineCatalogue(friendlyNames.map(item => rowNamed(item))).map(
    entry => entry.friendlyName,
  );
}

describe('the online catalogue order', () => {
  it('F-6102.BR-2: digits are compared as text', () => {
    deepStrictEqual(friendlyNamesOf(['AlmaLinux OS 8', 'AlmaLinux OS 10']), [
      'AlmaLinux OS 10',
      'AlmaLinux OS 8',
    ]);
  });

  it('F-6102.BR-2: names sort by their lower-case text', () => {
    deepStrictEqual(
      friendlyNamesOf(['Oracle Linux 9.5', 'openSUSE Leap 15', 'Kali Linux']),
      ['Kali Linux', 'openSUSE Leap 15', 'Oracle Linux 9.5'],
    );
  });

  it('F-6102.BR-2: the case is ignored', () => {
    deepStrictEqual(friendlyNamesOf(['beta', 'Alpha', 'ALPHA2']), [
      'Alpha',
      'ALPHA2',
      'beta',
    ]);
  });

  it('F-6102.BR-2: rows that compare equal keep the input order', () => {
    const input = Object.freeze([
      rowNamed('Same', 'one'),
      rowNamed('same', 'two'),
    ]);
    deepStrictEqual(
      sortOnlineCatalogue(input).map(entry => entry.name),
      ['one', 'two'],
    );
  });

  it('F-6102.BR-2: the input is not changed', () => {
    const input = [rowNamed('b'), rowNamed('a')];
    sortOnlineCatalogue(input);
    deepStrictEqual(input, [rowNamed('b'), rowNamed('a')]);
  });
});

describe('the install line', () => {
  for (const name of ['Ubuntu', 'Ubuntu-24.04', 'OracleLinux_9_5']) {
    it(`F-6102.BR-3: ${name} gives the line`, () => {
      deepStrictEqual(installCommandLine(name), {
        kind: 'line',
        text: `wsl.exe --install -d ${name}`,
      });
    });
  }

  it('F-6102.BR-3: a friendly name is not a valid name', () => {
    deepStrictEqual(installCommandLine('Ubuntu 24.04 LTS'), {
      kind: 'invalidName',
    });
  });

  for (const name of ['', '-d', 'a;b', 'a&b', '$(x)', 'a"b', 'a\nb', 'ünï']) {
    it(`brief: ${JSON.stringify(name)} is not a valid name`, () => {
      deepStrictEqual(installCommandLine(name), {kind: 'invalidName'});
    });
  }
});
