import {acceptanceChannelPortFor, type ChannelPort} from 'lib-log';

/** The variable that names the file the harness reads Dev Containers' log from. */
const LOG_FILE_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG';

/**
 * The channel port Dev Containers opens its log over: the real one, whose every line the file named by
 * `REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG` also gets, when the harness's switch is on; the real one itself otherwise.
 * Remote - SSH's own variable names another file, so a launch with both extensions keeps two logs.
 */
export function containersChannelPortFor(
  environment: Readonly<Record<string, string | undefined>>,
  real: ChannelPort,
  append: (file: string, text: string) => void,
): ChannelPort {
  return acceptanceChannelPortFor(environment, LOG_FILE_VARIABLE, real, append);
}
