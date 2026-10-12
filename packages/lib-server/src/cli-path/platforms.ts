/**
 * @fileoverview The platforms the editor's command-line program is built for.
 */

/** The `<os>-<arch>` tokens the editor's CLI is built for: every server platform except riscv64 and loong64. */
export const CLI_PLATFORMS: readonly string[] = [
  'linux-x64',
  'linux-arm64',
  'linux-armhf',
  'linux-ppc64le',
  'linux-s390x',
  'alpine-x64',
  'alpine-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64',
];
