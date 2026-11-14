/**
 * @fileoverview The check of a distro's registered name before it is used as an argument or as a path segment.
 */

/** Whether `name` can be a distro's registered name: it is not empty and holds no `@`, `/`, `\`, or control character. */
export function validDistroName(name: string): boolean {
  return name !== '' && !/[@/\\]|\p{Cc}/u.test(name);
}
