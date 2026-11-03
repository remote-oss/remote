/**
 * @fileoverview The lines a resolve step leaves in the log when it ends: the rule that ends the step, and what the
 * summary check found, which is a block with one line for each issue, or a line that no issue was found or that the
 * check is switched off.
 */

/** An issue as the summary names it. */
export interface SummaryIssue {
  status: string;
  message: string;
}

/** The rule that ends the text of a resolve step. */
export const STEP_RULE = '-'.repeat(40);

/** What the log says when the check found no issue. */
export const NO_HINTS_LINE = 'No hints found in the recent session.';

/** What the log says when the check is switched off. */
export const DISABLED_LINE = 'Enhanced session logs are disabled.';

/** The block of the issues: a heading framed by dashes, a line for each issue and a closing rule. */
export function summaryLines(issues: readonly SummaryIssue[]): string[] {
  return [
    `${'-'.repeat(10)} [Session Summary] ${'-'.repeat(10)}`,
    ...issues.map(issue => `[${issue.status}]: ${issue.message}`),
    STEP_RULE,
  ];
}
