import {deepStrictEqual} from 'node:assert';
import {featureProblems} from '../../src/config/feature-diagnostics.ts';

const S021 =
  'Absolute file paths are not allowed. Local file path must be indicated relative to the devcontainer.json.';
const S121 = 'Direct tarball references must be served over HTTPS.';
const S179 = 'Failed to parse feature identifier.';
const S195 = 'GitHub release feature id contains invalid characters';
const S246 = 'OCI Feature id contains invalid characters';
const S220 =
  'Legacy feature not supported. Please check https://containers.dev/features for replacements.';

/** The text of a configuration whose `features` hold `key` with the value `{}`. */
function textOf(key: string): string {
  return `{"features": {${JSON.stringify(key)}: {}}}`;
}

/** The message `key` earns, or none. */
function messageOf(key: string): string | undefined {
  return featureProblems(textOf(key))[0]?.message;
}

describe('the problems of the Feature ids (card containers-95)', () => {
  const FLAGGED: ReadonlyArray<readonly [string, string]> = [
    ['/etc/foo', S021],
    ['http://example.com/x.tgz', S121],
    ['owner/repo/bad id!', S195],
    ['a/b/c d@1', S195],
    ['localhost/owner/bad id!', S195],
    ['localhost:5000/a/b c', S195],
    ['foo:5000/owner/bad id!', S195],
    ['plain/owner/bad id!', S195],
    ['ghcr.io/owner/bad id!', S246],
    ['foo.bar/owner/bad id!', S246],
    ['ghcr.io/owner/name@sha256:abc', S246],
    ['owner/repo', S179],
    ['a/b', S179],
    ['a/b/c/d', S179],
    ['a/b/c/d e', S179],
    ['localhost:5000/a', S179],
    ['a:1/b', S179],
    ['a\\b', S179],
    ['C:\\x', S179],
    ['foo.bar\\x', S179],
    ['fish', S220],
    ['homebrew', S220],
  ];
  for (const [key, message] of FLAGGED) {
    it(`F-0414 AC-10 BR-18: ${JSON.stringify(key)} earns "${message.slice(0, 30)}"`, () => {
      deepStrictEqual(messageOf(key), message);
    });
  }

  const CLEAN = [
    'a/b/c',
    'a/b/c@1',
    'UPPER/Case/Ok',
    'foo.bar/x',
    'ghcr.io/a',
    'ghcr.io/devcontainers/features/node:1',
    'ghcr.io/devcontainers/features/node',
    '../up',
    './ok',
    'https://example.com/x.tgz',
    'https://example.com/foo.tar.gz',
    '',
    'maven',
    'gradle',
    'jupyterlab',
    'myrandomfeature',
    'octocat/Hello-World/foo',
  ];
  for (const key of CLEAN) {
    it(`F-0414 AC-10, AC-36, AC-38 BR-18: ${JSON.stringify(key)} earns nothing`, () => {
      deepStrictEqual(messageOf(key), undefined);
    });
  }

  it('F-0414 AC-8 3.3: the code of the legacy features is legacy-feature, and the others have referencing-a-feature', () => {
    deepStrictEqual(
      ['fish', '/x', 'a/b'].map(key => featureProblems(textOf(key))[0]?.code),
      ['legacy-feature', 'referencing-a-feature', 'referencing-a-feature'],
    );
  });

  it('F-0414 3.3: the range covers the whole property, from the key’s opening quote to the end of its value', () => {
    const text =
      '{\n  "features": {\n    "/etc/foo": {"a": 1},\n    "fish": ""\n  }\n}';
    deepStrictEqual(
      featureProblems(text).map(problem => [
        problem.key,
        text.slice(problem.range.start, problem.range.end),
      ]),
      [
        ['/etc/foo', '"/etc/foo": {"a": 1}'],
        ['fish', '"fish": ""'],
      ],
    );
  });

  it('F-0414 3.3: comments and trailing commas do not hide a problem', () => {
    deepStrictEqual(
      featureProblems(
        '{\n  // the features\n  "features": {\n    /* absolute */ "/x": {},\n  },\n}',
      ).map(problem => problem.key),
      ['/x'],
    );
  });

  it('F-0414 AC-11: only the top-level features object is looked at', () => {
    deepStrictEqual(
      featureProblems(
        '{"dev.containers.defaultFeatures": {"/x": {}}, "customizations": {"features": {"/y": {}}}}',
      ),
      [],
    );
  });

  it('F-0414 3.3: a file with no features, features that are not an object, and text that is not JSON give none', () => {
    deepStrictEqual(
      ['{}', '{"features": []}', '{"features": "/x"}', '', 'not json'].map(
        text => featureProblems(text),
      ),
      [[], [], [], [], []],
    );
  });

  it('F-0414 3.3: a property with no value yet still earns its problem, over the key', () => {
    const text = '{"features": {"/x"}}';
    deepStrictEqual(
      featureProblems(text).map(problem => [problem.key, problem.range]),
      [['/x', {start: 14, end: 18}]],
    );
  });
});
