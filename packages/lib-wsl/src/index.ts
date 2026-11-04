/**
 * @fileoverview lib-wsl: the WSL support: the decoding and parsing of `wsl.exe` text, the distro matching and the path
 * forms of the distro shares (pure), and over a process port the runner of `wsl.exe`, the path mapper and the host
 * channel.
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
export {filterDockerDesktop, type MatchResult, matchDistro} from './match.ts';
export {
  installCommandLine,
  type InstallLine,
  sortOnlineCatalogue,
} from './install.ts';
export {multiDistroAllowed, windowsBuildFromRelease} from './windows-build.ts';
export {
  distroToShare,
  isWindowsMountShape,
  mountToWindows,
  parseWslpathOutput,
  shareToDistro,
  type ShareResult,
  type WslpathResult,
} from './share-path.ts';
export {
  createWslRunner,
  type ExecExited,
  type ExecInput,
  type ExecRequest,
  type LiveProcess,
  type ManageRan,
  type ManageRequest,
  type ManageVerb,
  type RunFailed,
  type StartRequest,
  type WslFailure,
  type WslFailureKind,
  type WslRunner,
  type WslRunnerPorts,
} from './runner.ts';
export {
  createPathMapper,
  type DistroPath,
  type NotTranslatable,
  type PathMapper,
} from './path-mapper.ts';
export {
  createWslHostChannel,
  type WslHostChannelPorts,
} from './host-channel.ts';
export type {
  StartError,
  WslFiles,
  WslProcess,
  WslProcessSpawner,
  WslProcessSpecification,
  WslSession,
} from './process-port.ts';
