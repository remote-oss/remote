/**
 * @fileoverview The GitHub repository a label value names, and the address of that repository. A value is a web URL, an
 * ssh URL or the scp form, each naming the github.com host; the owner and the repository keep the value's case.
 */

/** The web form: a scheme, the host, two path parts, then anything that starts with `/`. */
const WEB_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(?:\/.*)?$/i;

/** The ssh form: an optional user, the host, two path parts, then anything that starts with `/`. */
const SSH_URL =
  /^ssh:\/\/(?:[^@/:]+@)?github\.com\/([^/?#]+)\/([^/?#]+)(?:\/.*)?$/i;

/** The scp form: a user, the host after a `:`, two path parts, then anything that starts with `/`. */
const SCP_FORM = /^(?:[^@/:]+)@github\.com:([^/?#]+)\/([^/?#]+)(?:\/.*)?$/i;

/** A GitHub repository a label value names: its owner and its name, in the value's own case. */
export interface GithubRepository {
  owner: string;
  repository: string;
}

/** The owner and the repository the forms name, a trailing `.git` removed, or undefined when the name is empty. */
function repositoryOf(
  owner: string,
  repository: string,
): GithubRepository | undefined {
  const name = repository.endsWith('.git')
    ? repository.slice(0, -4)
    : repository;
  return name ? {owner, repository: name} : undefined;
}

/** The GitHub repository `value` names, or undefined when it names none. */
export function githubRepositoryOf(
  value: string,
): GithubRepository | undefined {
  const match =
    WEB_URL.exec(value) ?? SSH_URL.exec(value) ?? SCP_FORM.exec(value);
  return match === null
    ? undefined
    : repositoryOf(String(match[1]), String(match[2]));
}

/** The characters an owner a GitHub name holds. */
const GITHUB_NAME = /^[A-Za-z0-9-]+$/;

/** The characters a repository a GitHub name holds. */
const GITHUB_REPOSITORY_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * The web address of `repository`, `https://github.com/<owner>/<repository>`, or undefined when either part holds a
 * character GitHub names don't.
 */
export function githubAddressOf(
  repository: GithubRepository,
): string | undefined {
  if (
    !GITHUB_NAME.test(repository.owner) ||
    !GITHUB_REPOSITORY_NAME.test(repository.repository)
  ) {
    return undefined;
  }
  return `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`;
}
