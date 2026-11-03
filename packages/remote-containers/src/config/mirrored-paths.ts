/**
 * @fileoverview The pure part of the lookup of a repository's configuration in the folders the user keeps for it: the
 * path a remote's URL maps to under a root, the guard that keeps that path inside the root, the roots the setting names,
 * and the URLs of the remotes that `git config` printed. A URL is read as text: never normalized, and its case is kept.
 */

import path from 'node:path';

/** The `.git` that ends the path of a URL. */
const GIT_SUFFIX = '.git';

/** `https://[userinfo@]host[:port]/path`: the authority is kept whole. */
const HTTPS_FORM = /^https:\/\/([^/?#]+)\/(.+)$/u;

/** `ssh://[userinfo@]host[:port]/path` and `git://[userinfo@]host[:port]/path`. */
const URL_FORM = /^(ssh|git):\/\/(?:[^/?#@]*@)?([^/?#:]+)(?::(\d+))?\/(.+)$/u;

/** The scp form `[userinfo@]host:path`, which has no scheme and whose path does not start with a slash. */
const SCP_FORM = /^(?:[^/?#@:]*@)?([^/?#@:]{2,}):([^/].*)$/u;

/** A character the path of a mirrored folder cannot hold: any control character. */
// eslint-disable-next-line no-control-regex -- the control characters are what is matched
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/** The path of a URL without its `.git`. */
function withoutSuffix(text: string): string {
  return text.endsWith(GIT_SUFFIX) ? text.slice(0, -GIT_SUFFIX.length) : text;
}

/** Whether the segments of `relative` all name something: none is empty, `.` or `..`, holds a `\` or a control character. */
function namesOnlyPlaces(relative: string): boolean {
  return (
    !relative.includes('\\') &&
    !CONTROL_CHARACTER.test(relative) &&
    relative
      .split('/')
      .every(segment => segment !== '' && segment !== '.' && segment !== '..')
  );
}

/**
 * The path under a root that the remote `url` maps to, in a list of none or one: `https://` keeps the whole authority,
 * the scp form and `git://` and `ssh://` without a port map to `<host>/<path>`, `ssh://` with a port to
 * `<host>/<port>/<path>`, and a trailing `.git` is removed. A form that is none of these, and a URL whose path has an
 * empty, `.` or `..` segment, a `\` or a control character, names nothing.
 */
export function mirroredPathsOf(url: string): string[] {
  const relative = relativeOf(url);
  return relative !== undefined && namesOnlyPlaces(relative) ? [relative] : [];
}

/** The path `url` maps to before the guard, none for a form that maps to nothing. */
function relativeOf(url: string): string | undefined {
  if (HTTPS_FORM.test(url)) {
    return withoutSuffix(url.replace(HTTPS_FORM, '$1/$2'));
  }
  if (URL_FORM.test(url)) {
    return withoutSuffix(
      url.replace(URL_FORM, (...groups: Array<string | undefined>) =>
        // The groups after the whole match and the scheme: the host, the port when there is one, and the path.
        groups
          .slice(2, 5)
          .filter(part => part !== undefined)
          .join('/'),
      ),
    );
  }
  // A single letter before the colon is a drive, not a host, so the host has at least two characters.
  return url.includes('://') || !SCP_FORM.test(url)
    ? undefined
    : withoutSuffix(url.replace(SCP_FORM, '$1/$2'));
}

/**
 * The folder under `root` that holds the configurations for `relative`, or none when the joined path, resolved, does
 * not stay under the root: a prefix test on the resolved paths with the trailing separator, so a root `/r` does not
 * take `/r2/…`.
 */
export function mirroredFolderIn(
  root: string,
  relative: string,
): string | undefined {
  const base = path.resolve(root);
  const folder = path.resolve(base, relative);
  return folder.startsWith(base.endsWith(path.sep) ? base : base + path.sep)
    ? folder
    : undefined;
}

/**
 * The roots the setting `dev.containers.repositoryConfigurationPaths` names: its entries that are literal absolute
 * paths, each without a trailing separator. An entry with a `~`, a `${…}` or a relative path is not one, and nothing
 * else the setting holds is a root.
 */
export function repositoryRootsOf(setting: unknown): string[] {
  if (!Array.isArray(setting)) {
    return [];
  }
  return setting.flatMap((entry: unknown) =>
    typeof entry === 'string' && path.isAbsolute(entry) && !entry.includes('${')
      ? [path.resolve(entry)]
      : [],
  );
}

/** The distinct URLs of the remotes that `git config --get-regexp '^remote\..*\.url$'` printed, in the order printed. */
export function remoteUrlsOf(printed: string): string[] {
  const urls = printed.split('\n').flatMap(line => {
    const trimmed = line.trim();
    const separator = trimmed.search(/\s/u);
    return separator === -1 ? [] : [trimmed.slice(separator).trim()];
  });
  return [...new Set(urls.filter(url => url !== ''))];
}

/** The userinfo of a URL's authority: everything between `//` and the last `@` before the path. */
const AUTHORITY_USERINFO = /(\/\/)[^/?#]*@/u;

/** The userinfo of the first segment of a derived path, where `https://` keeps the whole authority. */
const SEGMENT_USERINFO = /^[^/]*@/u;

/** A remote's URL for the log: the userinfo of its authority, where a credential may sit, taken out. */
export function loggableUrlOf(url: string): string {
  return url.replace(AUTHORITY_USERINFO, '$1');
}

/** A derived path for the log: the userinfo that `https://` keeps in its first segment taken out. */
export function loggableRelativeOf(relative: string): string {
  return relative.replace(SEGMENT_USERINFO, '');
}
