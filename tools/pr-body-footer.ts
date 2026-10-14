/**
 * @fileoverview pr-body-footer: removes the "Generated with Claude Code" footer and the claude.ai session link from a
 * pull request's body (the user's order, athena on 2026-10-14), run by .github/workflows/pr-body-footer.yml.
 *
 * Only whole lines in one of the three forms in use are removed, then the trailing blank lines; a line that mentions
 * claude.com among other words is kept. A body with none of them is left alone, so the `edited` event the workflow's own
 * edit fires finds nothing to do.
 */

import {readFileSync} from 'node:fs';
import {isMainModule} from './repository.ts';

const FOOTER_LINE =
  /^\s*(🤖 Generated with \[Claude Code\]\(https:\/\/claude\.(com\/claude-code|ai\/code\/session_[A-Za-z0-9]+)\)|https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+)\s*$/u;

/** The body without its footer lines, or undefined when it has none. */
export function withoutFooter(body: string): string | undefined {
  const lines = body.split('\n');
  const kept = lines.filter(line => !FOOTER_LINE.test(line));
  return kept.length === lines.length ? undefined : kept.join('\n').trimEnd();
}

type Request = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Reads the pull request's current body (not the event's snapshot, which an edit made since would make stale) and
 * writes it back without its footer; says which it did.
 */
export async function stripFooter(
  url: string,
  token: string,
  request: Request = fetch,
): Promise<'no footer' | 'footer removed'> {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
  };
  const current = await request(url, {headers});
  if (!current.ok) {
    throw new Error(`GET ${url}: ${String(current.status)}`);
  }
  const {body: currentBody} = (await current.json()) as {body: string | null};
  const body = withoutFooter(currentBody ?? '');
  if (body === undefined) {
    return 'no footer';
  }
  const response = await request(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({body}),
  });
  if (!response.ok) {
    throw new Error(`PATCH ${url}: ${String(response.status)}`);
  }
  return 'footer removed';
}

if (isMainModule(import.meta.url)) {
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'),
  ) as {pull_request: {url: string}};
  console.log(
    await stripFooter(event.pull_request.url, process.env.GITHUB_TOKEN ?? ''),
  );
}
