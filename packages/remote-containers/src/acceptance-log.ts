import {acceptanceLogFileOf, defaultFormat, type Sink} from 'lib-log';

/** The variable that names the file the harness reads Dev Containers' log from. */
const LOG_FILE_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG';

/**
 * The sink that gives the file named by `REMOTE_OSS_ACCEPTANCE_CONTAINERS_LOG` every line of the log, when the harness's
 * switch is on and the variable names a file; none in every other case. Remote - SSH's own variable names another file,
 * so a launch with both extensions keeps two logs.
 */
export function containersLogMirrorOf(
  environment: Readonly<Record<string, string | undefined>>,
  append: (file: string, text: string) => void,
): Sink | undefined {
  const file = acceptanceLogFileOf(environment, LOG_FILE_VARIABLE);
  return file === undefined
    ? undefined
    : {
        write: line => {
          append(file, `${defaultFormat(line)}\n`);
        },
      };
}
