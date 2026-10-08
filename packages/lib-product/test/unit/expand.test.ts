import {deepStrictEqual} from 'node:assert';
import {
  BASE_PLACEHOLDERS,
  expand,
  type PlaceholderValues,
} from '../../src/index.ts';

const VALUES: PlaceholderValues = {
  operatingSystem: 'linux',
  architecture: 'x64',
  commit: 'c0ffee',
  quality: 'stable',
  version: '1.2.3',
  release: '',
  applicationName: 'fixture-editor',
};

describe('expand (F-3902 rule 3)', () => {
  it('expands all six placeholders', () => {
    deepStrictEqual(
      expand(
        'https://host.invalid/${os}/${arch}/${commit}/${quality}/${version}${release}',
        VALUES,
        BASE_PLACEHOLDERS,
      ),
      {
        kind: 'url',
        address: 'https://host.invalid/linux/x64/c0ffee/stable/1.2.3',
      },
    );
  });

  it('expands applicationName only where it is allowed', () => {
    deepStrictEqual(
      expand(
        'https://host.invalid/${applicationName}',
        VALUES,
        BASE_PLACEHOLDERS,
      ),
      {kind: 'unknownPlaceholder', name: 'applicationName'},
    );
  });

  it('expands applicationName when the names allow it', () => {
    deepStrictEqual(
      expand('https://host.invalid/${applicationName}', VALUES, [
        ...BASE_PLACEHOLDERS,
        'applicationName',
      ]),
      {kind: 'url', address: 'https://host.invalid/fixture-editor'},
    );
  });

  it('names an unknown placeholder', () => {
    deepStrictEqual(
      expand('https://host.invalid/${platform}', VALUES, BASE_PLACEHOLDERS),
      {kind: 'unknownPlaceholder', name: 'platform'},
    );
  });

  it('rejects a result that is not an http or https URL', () => {
    deepStrictEqual(
      expand('ftp://host.invalid/${os}', VALUES, BASE_PLACEHOLDERS),
      {
        kind: 'notHttpUrl',
        value: 'ftp://host.invalid/linux',
      },
    );
  });

  it('rejects a result that is not an absolute URL', () => {
    deepStrictEqual(expand('server.tar.gz', VALUES, BASE_PLACEHOLDERS), {
      kind: 'notHttpUrl',
      value: 'server.tar.gz',
    });
  });

  it('uses a value without placeholders as one URL for every host', () => {
    deepStrictEqual(expand('https://host.invalid/server.tar.gz', VALUES, []), {
      kind: 'url',
      address: 'https://host.invalid/server.tar.gz',
    });
  });
});
