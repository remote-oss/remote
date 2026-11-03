/**
 * @fileoverview The remote a Git repository can be cloned from, read from the text of its `config` file.
 */

const REMOTE_SECTION = /^\[remote "([^"]*)"\]\s*$/;
const URL_LINE = /^url\s*=\s*(\S.*?)\s*$/;

/** The `url` of the remote `origin` or, with no `origin`, of the first remote; none when the file names no remote with one. */
export function gitRemoteOf(configText: string): string | undefined {
  const urls = new Map<string, string>();
  let section: string | undefined;
  for (const line of configText.split(/\r?\n/).map(each => each.trim())) {
    const remote = REMOTE_SECTION.exec(line);
    if (remote !== null) {
      section = remote[1];
    } else if (line.startsWith('[')) {
      section = undefined;
    } else if (section !== undefined && !urls.has(section)) {
      const url = URL_LINE.exec(line)?.[1];
      if (url !== undefined) {
        urls.set(section, url);
      }
    }
  }
  return urls.get('origin') ?? [...urls.values()][0];
}
