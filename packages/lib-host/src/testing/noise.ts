/**
 * @fileoverview ADR-0010's noisy neighbours for tests: the lines a user's startup files, `~/.ssh/rc` or a PAM module
 * may write around what a parser reads. No bundle imports this module.
 */

/** N1 to N4 of ADR-0010, each on its own line. */
const PLAIN_NOISE = [
  'ERROR: Your fridge is not running',
  'see remote-oss-server-result-begin for details',
  'status=Ok',
  'fact host.arch x64',
  'motd: Permission denied (publickey) is a test',
] as const;

/** The noise lines N1 to N5: N1 to N4, then the same lines ending in a carriage return. */
export const NOISE_LINES: readonly string[] = [
  ...PLAIN_NOISE,
  ...PLAIN_NOISE.map(line => `${line}\r`),
];

/** `lines` with the noise before, between every two of them, and after. */
export function withNoise(lines: readonly string[]): string[] {
  return [...NOISE_LINES, ...lines.flatMap(line => [line, ...NOISE_LINES])];
}
