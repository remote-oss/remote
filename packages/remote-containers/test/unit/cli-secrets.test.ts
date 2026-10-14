import {deepStrictEqual} from 'node:assert';
import {referencedSecrets, scrubbed} from '../../src/cli/cli-secrets.ts';

const CONFIG = '{"containerEnv": {"T": "${localEnv:GITHUB_TOKEN}"}}';
const ENVIRONMENT = {
  GITHUB_TOKEN: 's3cr3t-token',
  OTHER_TOKEN: 'another-long-value',
  SHORT: 'short1',
};

describe('the secrets the CLI echoes (card containers-04)', () => {
  it('R-26: a referenced long variable is a secret, with the reference as written', () => {
    deepStrictEqual(referencedSecrets(CONFIG, ENVIRONMENT), [
      {value: 's3cr3t-token', reference: '${localEnv:GITHUB_TOKEN}'},
    ]);
  });

  it('R-26: an env reference counts too, and the name of a reference with a default is the first piece', () => {
    deepStrictEqual(
      referencedSecrets('{"a": "${env:OTHER_TOKEN:fallback}"}', ENVIRONMENT),
      [{value: 'another-long-value', reference: '${env:OTHER_TOKEN}'}],
    );
  });

  it('R-26: a referenced variable of fewer than 8 characters is not a secret', () => {
    deepStrictEqual(
      referencedSecrets('{"a": "${localEnv:SHORT}"}', ENVIRONMENT),
      [],
    );
  });

  it('R-26: a variable the configuration does not reference is not a secret, and an unset one is none', () => {
    deepStrictEqual(
      referencedSecrets('{"a": "${localEnv:MISSING}"}', ENVIRONMENT),
      [],
    );
  });

  it('R-26: one value behind two names is one secret, and secrets come longest first', () => {
    deepStrictEqual(
      referencedSecrets(
        '{"a": "${localEnv:A_ONE}${localEnv:A_TWO}${localEnv:B_LONG}"}',
        {
          A_ONE: 'same-value-x',
          A_TWO: 'same-value-x',
          B_LONG: 'a-much-longer-value',
        },
      ).map(secret => secret.value),
      ['a-much-longer-value', 'same-value-x'],
    );
  });

  it('R-26: a docker run line with the value reaches the caller with the reference', () => {
    deepStrictEqual(
      scrubbed(
        'Run: docker run -e T=s3cr3t-token alpine',
        referencedSecrets(CONFIG, ENVIRONMENT),
      ),
      'Run: docker run -e T=${localEnv:GITHUB_TOKEN} alpine',
    );
  });

  it('R-26: every occurrence is replaced', () => {
    deepStrictEqual(
      scrubbed(
        's3cr3t-token and s3cr3t-token',
        referencedSecrets(CONFIG, ENVIRONMENT),
      ),
      '${localEnv:GITHUB_TOKEN} and ${localEnv:GITHUB_TOKEN}',
    );
  });

  it('R-26: an unreferenced variable that appears in a line is left alone', () => {
    deepStrictEqual(
      scrubbed(
        'x another-long-value y',
        referencedSecrets(CONFIG, ENVIRONMENT),
      ),
      'x another-long-value y',
    );
  });

  it('R-26: a text with no secrets is returned as it is', () => {
    deepStrictEqual(scrubbed('plain', []), 'plain');
  });

  const PEM_VALUE = '-----BEGIN KEY-----\nAAAAbbbbCCCCdddd\n-----END KEY-----';

  it('R-26: each line of a multi-line value of 8 characters or more is a secret under the same reference, after the whole value', () => {
    deepStrictEqual(
      referencedSecrets('{"a": "${localEnv:PEM_VALUE}"}', {PEM_VALUE}).map(
        secret => [secret.value, secret.reference],
      ),
      [
        [
          `-----BEGIN KEY-----\\nAAAAbbbbCCCCdddd\\n-----END KEY-----`,
          '${localEnv:PEM_VALUE}',
        ],
        [PEM_VALUE, '${localEnv:PEM_VALUE}'],
        ['-----BEGIN KEY-----', '${localEnv:PEM_VALUE}'],
        ['-----END KEY-----', '${localEnv:PEM_VALUE}'],
        ['AAAAbbbbCCCCdddd', '${localEnv:PEM_VALUE}'],
      ],
    );
  });

  it('R-26: a Run text holding only the first line of a multi-line value is scrubbed, and a line shorter than 8 characters is not an entry', () => {
    const secrets = referencedSecrets('{"a": "${localEnv:PEM_VALUE}"}', {
      PEM_VALUE: '-----BEGIN KEY-----\nshort\n-----END KEY-----',
    });
    deepStrictEqual(
      [
        scrubbed('Run: docker run -e K=-----BEGIN KEY-----', secrets),
        secrets.some(secret => secret.value === 'short'),
      ],
      ['Run: docker run -e K=${localEnv:PEM_VALUE}', false],
    );
  });

  it('R-26: the JSON-escaped form of a value is a secret too', () => {
    deepStrictEqual(
      scrubbed(
        'label={"k":"pa\\"ss\\\\word12"}',
        referencedSecrets('{"a": "${localEnv:ODD_VALUE}"}', {
          ODD_VALUE: 'pa"ss\\word12',
        }),
      ),
      'label={"k":"${localEnv:ODD_VALUE}"}',
    );
  });
});
