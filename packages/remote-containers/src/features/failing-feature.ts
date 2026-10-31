/**
 * @fileoverview Which Feature a failed build names, and how its key fails. The dev container CLI writes no field that
 * names the failing Feature: its error outcome has one sentence, and the sentence quotes the key. The Features the
 * configuration asks for are the candidates; the failing one is the single candidate whose key occurs, between single
 * quotes, in that sentence. The sentence's own wording is never parsed, except for one constant that the CLI writes
 * when it falls back to GitHub releases and then names no key.
 */

/** How the key of a failing Feature fails, which tells the dialog's detail. */
export type FeatureFailure = 'empty' | 'legacy' | 'notFound';

/**
 * What the CLI's error sentence starts with when it fell back to GitHub releases and could not fetch the tarball
 * ([devcontainers-cli] `containerFeaturesConfiguration.ts` at tag v0.89.0, line 1073).
 */
const TARBALL_FAILED = '(!) Failed to fetch tarball for ';

/** A key of the legacy GitHub-release form: `owner/repository/name`, the first part no registry host. */
function isReleaseKey(key: string): boolean {
  const parts = key.split('/');
  const [owner = ''] = parts;
  return (
    parts.length === 3 &&
    parts.every(part => part !== '' && !/\s/u.test(part)) &&
    !/[.:]/u.test(owner)
  );
}

/** The kind of failure a key is, by its shape: empty, a bare word, or any other. */
function failureOfKey(key: string): FeatureFailure {
  if (key === '') {
    return 'empty';
  }
  return /[/\\]/u.test(key) ? 'notFound' : 'legacy';
}

/**
 * How the Feature that `message` (the CLI's error sentence) names fails, among the `candidates`; none when it names no
 * one candidate, several, or when the failure is not a Feature's resolution.
 */
export function featureFailureOf(
  candidates: readonly string[],
  message: string,
): FeatureFailure | undefined {
  const quoted = candidates.filter(key => message.includes(`'${key}'`));
  if (quoted.length === 1) {
    return failureOfKey(quoted[0] ?? '');
  }
  if (quoted.length === 0 && message.startsWith(TARBALL_FAILED)) {
    return candidates.filter(isReleaseKey).length === 1
      ? 'notFound'
      : undefined;
  }
  return undefined;
}
