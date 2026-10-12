/**
 * @fileoverview The Windows build, read from the release string of the operating system, and the rule it decides:
 * from which build several WSL distros can be installed.
 */

/** The first build that allows several distros. */
const FIRST_MULTI_DISTRO_BUILD = 18362;

/** The build in a release string such as `10.0.17763`: its third part, when that is all digits. */
export function windowsBuildFromRelease(osRelease: string): number | undefined {
  const build = osRelease.split('.')[2];
  return build !== undefined && /^\d+$/.test(build) ? Number(build) : undefined;
}

/** Whether several distros are allowed; a build that is not known allows them. */
export function multiDistroAllowed(windowsBuild: number | undefined): boolean {
  return windowsBuild === undefined || windowsBuild >= FIRST_MULTI_DISTRO_BUILD;
}
