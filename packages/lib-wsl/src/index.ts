/**
 * @fileoverview lib-wsl: the pure parts of the WSL support: the decoding and parsing of `wsl.exe` text, the
 * distro matching and the path forms of the distro shares. Nothing here starts a process or touches a file.
 */
export {type OnlineResult, type OnlineRow, parseOnline} from './online.ts';
export {parseStatus, type WslStatus} from './status.ts';
export {decodeManagementOutput} from './decode.ts';
export {
  type DistroRow,
  type DistroState,
  type DistroVersion,
  type ListResult,
  parseList,
} from './list.ts';
export {
  installCommandLine,
  type InstallLine,
  sortOnlineCatalogue,
} from './install.ts';
export {multiDistroAllowed, windowsBuildFromRelease} from './windows-build.ts';
export {
  distroToShare,
  isWindowsMountShape,
  parseWslpathOutput,
  shareToDistro,
  type ShareResult,
  type WslpathResult,
} from './share-path.ts';
