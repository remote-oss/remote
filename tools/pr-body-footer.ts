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

async function main(): Promise<void> {
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'),
  ) as {pull_request: {url: string; body: string | null}};
  const body = withoutFooter(event.pull_request.body ?? '');
  if (body === undefined) {
    console.log('no footer');
    return;
  }
  const response = await fetch(event.pull_request.url, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
      accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({body}),
  });
  if (!response.ok) {
    throw new Error(
      `PATCH ${event.pull_request.url}: ${String(response.status)}`,
    );
  }
  console.log('footer removed');
}

if (isMainModule(import.meta.url)) {
  await main();
}
