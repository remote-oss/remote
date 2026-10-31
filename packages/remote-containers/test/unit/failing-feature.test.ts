import {deepStrictEqual} from 'node:assert';
import {featureFailureOf} from '../../src/cli/failing-feature.ts';

/** The sentence the CLI 0.89.0 gives for a bare word it does not know (measured). */
function legacy(key: string): string {
  return `Legacy feature '${key}' not supported. Please check https://containers.dev/features for replacements.\nIf you were hoping to use local Features, remember to prepend your Feature name with "./". Please check https://containers.dev/implementors/features-distribution/#addendum-locally-referenced for more information.`;
}

/** The sentence the CLI 0.89.0 gives for a key it could not process (measured). */
function unprocessed(key: string): string {
  return `ERR: Feature '${key}' could not be processed.  You may not have permission to access this Feature, or may not be logged in.  If the issue persists, report this to the Feature author.`;
}

/** The sentence the CLI 0.89.0 gives when the GitHub-release fallback fails (measured): no key in it. */
const TARBALL =
  '(!) Failed to fetch tarball for foo_0_github-repo after attempting 2 possibilities.';

/** The sentence of a script that exits 1 (measured): the build command, which quotes no key. */
const BUILD_COMMAND =
  'Command failed: docker buildx build --load --build-context dev_containers_feature_content_source=/work/.devcontainer --build-arg _DEV_CONTAINERS_BASE_IMAGE=alpine:3.20 -f Dockerfile.extended -t vsc-r3-features /tmp/empty-folder';

describe('the Feature a failed build names (card containers-94)', () => {
  it('F-0414 7.E6: the empty key fails as empty', () => {
    deepStrictEqual(featureFailureOf([''], legacy('')), 'empty');
  });

  it('F-0414 7.E6: a bare word the CLI does not know fails as legacy', () => {
    deepStrictEqual(
      [
        featureFailureOf(['fish'], legacy('fish')),
        featureFailureOf(['myrandomfeature'], legacy('myrandomfeature')),
      ],
      ['legacy', 'legacy'],
    );
  });

  it('F-0414 7.E6: an absolute path, an address, owner/repo and a bad registry id fail as not found', () => {
    deepStrictEqual(
      [
        '/etc/foo',
        'http://example.invalid/x',
        'owner/repo',
        'owner/repo/bad id!',
        'ghcr.io/owner/bad id!',
      ].map(key => featureFailureOf([key], unprocessed(key))),
      Array.from({length: 5}, () => 'notFound'),
    );
  });

  it('F-0414 7.E6: a registry id that does not exist, and a pinned digest that is gone, fail as not found', () => {
    deepStrictEqual(
      [
        'localhost:55055/x/features/nothere:1',
        `localhost:55055/x/features/nothere@sha256:${'0'.repeat(64)}`,
      ].map(key => featureFailureOf([key], unprocessed(key))),
      ['notFound', 'notFound'],
    );
  });

  it('F-0414 7.E6: the failing key is the one candidate quoted, among several', () => {
    deepStrictEqual(
      featureFailureOf(
        ['ghcr.io/devcontainers/features/git:1', '', 'fish'],
        legacy('fish'),
      ),
      'legacy',
    );
  });

  it('F-0414 7.E6: a message that quotes several candidates stays generic', () => {
    deepStrictEqual(
      featureFailureOf(
        ['fish', 'maven'],
        `${legacy('fish')} ${legacy('maven')}`,
      ),
      undefined,
    );
  });

  it('F-0414 7.E6: a message that quotes no candidate stays generic, as a string override does', () => {
    deepStrictEqual(featureFailureOf(['./fa'], legacy('a')), undefined);
  });

  it('F-0414 7.E6: a key that only starts with a candidate is not that candidate', () => {
    deepStrictEqual(
      featureFailureOf(['owner/repo'], unprocessed('owner/repo/bad id!')),
      undefined,
    );
  });

  it('F-0414 7.E6: a script’s exit quotes no key and stays generic', () => {
    deepStrictEqual(featureFailureOf(['./fexit'], BUILD_COMMAND), undefined);
  });

  it('F-0414 7.E6: the GitHub-release fallback fails as not found when one candidate has the owner/repo/name shape', () => {
    deepStrictEqual(
      featureFailureOf(
        ['ghcr.io/devcontainers/features/git:1', 'octocat/Hello-World/foo'],
        TARBALL,
      ),
      'notFound',
    );
  });

  it('F-0414 7.E6: the GitHub-release fallback stays generic with none or two candidates of that shape', () => {
    deepStrictEqual(
      [
        featureFailureOf(['ghcr.io/devcontainers/features/git:1'], TARBALL),
        featureFailureOf(['a/b/c', 'd/e/f'], TARBALL),
        featureFailureOf(['a/b'], TARBALL),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('F-0414 7.E6: a tarball message that quotes two candidates stays generic, even with one owner/repo/name key among them', () => {
    deepStrictEqual(
      featureFailureOf(
        ['octocat/Hello-World/foo', 'fish'],
        `${TARBALL} 'octocat/Hello-World/foo' 'fish'`,
      ),
      undefined,
    );
  });

  it('F-0414 7.E6: a registry host or a blank in the first part is not the owner/repo/name shape', () => {
    deepStrictEqual(
      [
        featureFailureOf(['localhost:5000/b/c'], TARBALL),
        featureFailureOf(['a b/c/d'], TARBALL),
        featureFailureOf(['a//d'], TARBALL),
      ],
      [undefined, undefined, undefined],
    );
  });
});
