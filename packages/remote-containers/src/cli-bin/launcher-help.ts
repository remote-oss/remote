/**
 * @fileoverview The help of the `devcontainer` launcher's own commands : `open`, and the legacy `build`
 * surface, with the texts of the open-source CLI where the options are its own. The help of any other command is the
 * CLI's.
 */

/** One option of a command's help. */
interface HelpOption {
  names: string;
  description: string;
  /** The yargs-style notes after the description. */
  notes: string;
}

/** What the help of a command shows. */
interface Help {
  title: string;
  description: string;
  positional: {name: string; description: string; notes: string};
  options: readonly HelpOption[];
}

const HELP_OPTION = {
  names: '-h, --help',
  description: 'Show help',
  notes: '[boolean]',
};
const TELEMETRY_OPTION = {
  names: '--disable-telemetry',
  description: 'Disable telemetry',
  notes: '[boolean] [default: false]',
};
const CONFIG_OPTION = {
  names: '--config',
  description:
    'devcontainer.json path. The default is to use .devcontainer/devcontainer.json or, if that does not exist, .devcontainer.json in the workspace folder.',
  notes: '[string]',
};

const OPEN_HELP: Help = {
  title: 'devcontainer open [path]',
  description: 'Open a dev container in VS Code',
  positional: {
    name: 'path',
    description: 'path to project folder',
    notes: '[default: "."]',
  },
  options: [HELP_OPTION, TELEMETRY_OPTION, CONFIG_OPTION],
};

const BUILD_HELP: Help = {
  title: 'devcontainer build [path]',
  description: 'Build a dev container image',
  positional: {
    name: 'path',
    description: 'path to folder containing .devcontainer to build',
    notes: '[string]',
  },
  options: [
    HELP_OPTION,
    TELEMETRY_OPTION,
    {
      names: '--verbose',
      description: 'Run build with increased log level',
      notes: '[boolean]',
    },
    {
      names: '--user-data-folder',
      description:
        'Host path to a directory that is intended to be persisted and share state between sessions.',
      notes: '[string]',
    },
    {
      names: '--docker-path',
      description: 'Docker CLI path.',
      notes: '[string]',
    },
    {
      names: '--docker-compose-path',
      description: 'Docker Compose CLI path.',
      notes: '[string]',
    },
    {
      names: '--workspace-folder',
      description:
        'Workspace folder path. The devcontainer.json will be looked up relative to this path. If not provided, defaults to the current directory.',
      notes: '[string]',
    },
    CONFIG_OPTION,
    {
      names: '--log-level',
      description: 'Log level.',
      notes: '[choices: "info", "debug", "trace"] [default: "info"]',
    },
    {
      names: '--log-format',
      description: 'Log format.',
      notes: '[choices: "text", "json"] [default: "text"]',
    },
    {
      names: '--no-cache',
      description: 'Builds the image with `--no-cache`.',
      notes: '[boolean] [default: false]',
    },
    {names: '--image-name', description: 'Image name.', notes: '[string]'},
    {
      names: '--cache-from',
      description: 'Additional image to use as potential layer cache',
      notes: '[string]',
    },
    {
      names: '--buildkit',
      description: 'Control whether BuildKit should be used',
      notes: '[choices: "auto", "never"] [default: "auto"]',
    },
    {
      names: '--platform',
      description: 'Set target platforms.',
      notes: '[string]',
    },
    {
      names: '--push',
      description: 'Push to a container registry.',
      notes: '[boolean] [default: false]',
    },
  ],
};

/** The text of `help`, laid out in columns. */
function rendered(help: Help): string {
  const width = Math.max(
    help.positional.name.length,
    ...help.options.map(option => option.names.length),
  );
  function line(names: string, description: string, notes: string): string {
    return `  ${names.padEnd(width)}  ${description}  ${notes}`;
  }
  return [
    help.title,
    '',
    help.description,
    '',
    'Positionals:',
    line(
      help.positional.name,
      help.positional.description,
      help.positional.notes,
    ),
    '',
    'Options:',
    ...help.options.map(option =>
      line(option.names, option.description, option.notes),
    ),
    '',
  ].join('\n');
}

/** The help of `devcontainer open`. */
export const OPEN_HELP_TEXT = rendered(OPEN_HELP);

/** The help of the legacy `devcontainer build`. */
export const BUILD_HELP_TEXT = rendered(BUILD_HELP);

/** The command line the top-level help lists first. */
export const OPEN_COMMAND_LINE =
  '  devcontainer open [path]          Open a dev container in VS Code';

/**
 * The top-level help: the CLI's own, with the line of `open` first among the commands, and a last line naming the CLI's
 * version and the extension's install folder.
 */
export function topHelpOf(
  cliHelp: string,
  cliVersion: string,
  extensionPath: string,
): string {
  const lines = cliHelp.split('\n');
  const commands = lines.indexOf('Commands:');
  const withOpen =
    commands === -1
      ? lines
      : [
          ...lines.slice(0, commands + 1),
          OPEN_COMMAND_LINE,
          ...lines.slice(commands + 1),
        ];
  return `${withOpen.join('\n').trimEnd()}\n\ndevcontainer@${cliVersion} ${extensionPath}\n`;
}
