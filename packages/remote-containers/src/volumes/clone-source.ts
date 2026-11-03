/**
 * @fileoverview What a repository source names before anything is cloned: the text the user typed or a link gave, as
 * the clone and the volume's name read it, or why it is refused. Nothing here runs git; a refused source never reaches
 * it, and the only way to git's argument list is a source this module accepted.
 */

/** Where a source came from: the user's own input, or a link or a table of the extension's. */
export type CloneOrigin = 'typed' | 'link';

/** A source the clone may take. */
export interface CloneSource {
  /** The source as typed or resolved: trimmed, a GitHub shorthand expanded; the digest of the volume name is over it. */
  repositoryPath: string;
  /** What git clones: the repository part, without a GitHub `/tree/`, `/commit/` or `/pull/` part. */
  urlToClone: string;
  /** The branch or tag of a `/tree/` URL, slashes kept, or the full SHA of a `/commit/` URL. */
  ref?: string;
  /** Set when the ref is a `/commit/` URL's SHA, which is checked out after the clone instead of cloned as a branch. */
  commit?: true;
  /** The number of a GitHub `/pull/` URL. */
  pullRequest?: number;
  /** The repository's own name: the folder under `/workspaces`, and the first part of the volume's name. */
  repositoryName: string;
}

/** Why a source is refused before any git or Docker step. */
export type SourceRefusal =
  /** Nothing is left once the whitespace around it is removed. */
  | 'empty'
  /** It starts with `-`, or its host or its ref does, so git or ssh would read it as an option. */
  | 'option'
  /** It holds a control character (a line break, a tab, NUL), which git's configuration and ssh read specially. */
  | 'control'
  /** Its repository name is empty, `.` or `..`, which can't be the folder under `/workspaces`. */
  | 'folder'
  /** It names a transport git runs a program for (`ext::`, `fd::`), or, from a link, `file://`. */
  | 'protocol'
  /** From a link, it names neither an allowed protocol nor the scp-style `user@host:path`. */
  | 'notAllowed';

/** The protocols a source from a link may name. */
const LINK_PROTOCOLS: readonly string[] = ['https', 'http', 'ssh', 'git'];

/** A transport git hands to a helper program of its own, written `<name>::<address>`. */
const HELPER_TRANSPORT = /^[A-Za-z][A-Za-z0-9+.-]*::/;

/** A control character, the C0 set and DEL; whitespace around the input was removed before this is looked for. */
// eslint-disable-next-line no-control-regex -- control characters are what this matches
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/** A URL's scheme. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

/** A URL or an scp-style source whose host, after any user, starts with `-`, which ssh would take as an option. */
const OPTION_HOST = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^/@]*@)?|[^\s/@:]+@)-/;

/** The scp-style form `user@host:path`, with no scheme and a path after the colon. */
const SCP_STYLE = /^[^\s/@:]+@[^\s/:]+:[^\s]+$/;

/**
 * The user and password of an `http(s)` URL, up to the last `@` before the path, which are kept out of everything the
 * clone stores, labels or logs.
 */
const WEB_USERINFO = /^(https?:\/\/)[^/?#]*@/i;

/** A GitHub shorthand: exactly two non-empty segments, no scheme. */
const SHORTHAND = /^[^\s/:]+\/[^\s/:]+$/;

/** A GitHub URL: `https://`, the host `github.com` in any case or `www.github.com`, then the owner and the repository. */
const GITHUB =
  /^(https:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+?(?:\.git)?)(\/.*)?$/i;

/** The protocols `git` clones by, in `protocol.allow`'s form, for a source from a link. */
export const LINK_PROTOCOL_ALLOW: readonly string[] = [
  'https',
  'http',
  'ssh',
  'git',
];

/** The path of a source: after a URL's scheme and host, after the scp form's colon, or the whole text otherwise. */
function pathOf(text: string): string {
  const url = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*(.*)$/.exec(text);
  if (url !== null) {
    return String(url[1]);
  }
  return SCP_STYLE.test(text) ? text.slice(text.indexOf(':') + 1) : text;
}

/** The last non-empty segment of a source's path, with a trailing `.git` dropped. */
function lastSegment(text: string): string {
  const segments = pathOf(text)
    .split(/[/\\]/)
    .filter(segment => segment !== '');
  const last = segments.at(-1) ?? '';
  return last.endsWith('.git') ? last.slice(0, -'.git'.length) : last;
}

/** A GitHub URL's repository, ref, commit or pull request; undefined for any other source. */
function githubParts(
  text: string,
):
  | Pick<CloneSource, 'urlToClone' | 'ref' | 'commit' | 'pullRequest'>
  | undefined {
  const match = GITHUB.exec(text);
  if (match === null) {
    return undefined;
  }
  const repository = String(match[1]);
  const rest = (match[2] ?? '').replace(/\/+$/, '');
  const tree = /^\/tree\/(.+)$/.exec(rest);
  if (tree !== null) {
    return {urlToClone: repository, ref: String(tree[1])};
  }
  const commit = /^\/commit\/([0-9a-f]{40})$/i.exec(rest);
  if (commit !== null) {
    return {urlToClone: repository, ref: String(commit[1]), commit: true};
  }
  const pull = /^\/pull\/([0-9]+)$/.exec(rest);
  if (pull !== null) {
    return {urlToClone: repository, pullRequest: Number(pull[1])};
  }
  return rest === '' ? {urlToClone: repository} : undefined;
}

/** Why `text`, trimmed, may not be cloned from `origin`; undefined when it may. */
function refusalOf(
  text: string,
  origin: CloneOrigin,
): SourceRefusal | undefined {
  if (text === '') {
    return 'empty';
  }
  if (CONTROL_CHARACTER.test(text)) {
    return 'control';
  }
  if (text.startsWith('-') || OPTION_HOST.test(text)) {
    return 'option';
  }
  if (HELPER_TRANSPORT.test(text)) {
    return 'protocol';
  }
  if (origin === 'typed') {
    return undefined;
  }
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (scheme === 'file') {
    return 'protocol';
  }
  return (scheme !== undefined && LINK_PROTOCOLS.includes(scheme)) ||
    (scheme === undefined && (SCP_STYLE.test(text) || SHORTHAND.test(text)))
    ? undefined
    : 'notAllowed';
}

/**
 * The source `input` names, or why it is refused. Whitespace around it is removed first; a GitHub shorthand becomes
 * its `https://github.com/` URL; an `http(s)` URL loses its user and password, while `ssh://` and the scp form keep
 * their user; a GitHub URL's `/tree/`, `/commit/` or `/pull/` part is read off it; any other text
 * is used as typed. A local path is a source only when the user typed it.
 */
export function cloneSourceOf(
  input: string,
  origin: CloneOrigin,
): CloneSource | {refused: SourceRefusal} {
  const trimmed = input.trim();
  const refused = refusalOf(trimmed, origin);
  if (refused !== undefined) {
    return {refused};
  }
  const repositoryPath = SHORTHAND.test(trimmed)
    ? `https://github.com/${trimmed}`
    : trimmed.replace(WEB_USERINFO, '$1');
  const github = githubParts(repositoryPath);
  const urlToClone = github?.urlToClone ?? repositoryPath;
  const repositoryName = lastSegment(urlToClone);
  if (['', '.', '..'].includes(repositoryName)) {
    return {refused: 'folder'};
  }
  if (github?.ref?.startsWith('-') === true) {
    return {refused: 'option'};
  }
  return {
    repositoryPath,
    urlToClone,
    ...(github?.ref === undefined ? {} : {ref: github.ref}),
    ...(github?.commit === undefined ? {} : {commit: github.commit}),
    ...(github?.pullRequest === undefined
      ? {}
      : {pullRequest: github.pullRequest}),
    repositoryName,
  };
}
