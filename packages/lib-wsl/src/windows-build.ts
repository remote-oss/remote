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

/** The first build with the path translation of `wslpath`. */
const FIRST_PATH_TRANSLATION_BUILD = 17063;

/** The first build whose share host is `wsl.localhost`; the builds before it have `wsl$`. */
const FIRST_LOCALHOST_SHARE_BUILD = 21354;

/** The host of a distro's share. */
export type ShareHost = 'wsl.localhost' | 'wsl$';

/** Whether a path can be translated between Windows and a distro; a build that is not known allows it. */
export function pathTranslationAvailable(
  windowsBuild: number | undefined,
): boolean {
  return (
    windowsBuild === undefined || windowsBuild >= FIRST_PATH_TRANSLATION_BUILD
  );
}

/** The host of the share on this build; a build that is not known has the newer host. */
export function shareHostFor(windowsBuild: number | undefined): ShareHost {
  return windowsBuild === undefined ||
    windowsBuild >= FIRST_LOCALHOST_SHARE_BUILD
    ? 'wsl.localhost'
    : 'wsl$';
}
