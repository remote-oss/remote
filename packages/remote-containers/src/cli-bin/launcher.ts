/**
 * @fileoverview The `devcontainer` launcher's command line `open` and the legacy `build` are
 * ours, the help adds the line of `open`, and anything else goes to the pinned CLI as it came. The program that runs
 * it gives the machine through the ports.
 */

import {buildArgumentsOf} from './build-arguments.ts';
import {BUILD_HELP_TEXT, OPEN_HELP_TEXT, topHelpOf} from './launcher-help.ts';
import {openAddressOf} from './open-address.ts';
import {openArgumentsOf} from './open-arguments.ts';
import {openPlanOf, type OpenPorts} from './open-plan.ts';

/** What the launcher needs of the machine. */
export interface LauncherPorts extends OpenPorts {
  /** The extension's install folder. */
  extensionPath: string;
  /** Milliseconds since the program started. */
  elapsed(): number;
  /** The facts of the version banner: this Node and the operating system. */
  system: {
    nodeVersion: string;
    platform: string;
    release: string;
    arch: string;
  };
  stdout(text: string): void;
  stderr(text: string): void;
  /** The text the pinned CLI prints for `argv`, and its version. */
  cliOutput(argv: readonly string[]): Promise<string>;
  /** Runs the pinned CLI on `argv` with the terminal as it is; gives its exit status. */
  runCli(argv: readonly string[]): Promise<number>;
  /** Starts the editor on `address` and lets it go. */
  launchEditor(address: string): void;
}

/** The first line `open` prints: the open CLI's version banner, in the terminal's bold. */
function bannerOf(version: string, ports: LauncherPorts): string {
  const {nodeVersion, platform, release, arch} = ports.system;
  return `\u001b[1m[${String(ports.elapsed())} ms] @devcontainers/cli ${version}. Node.js ${nodeVersion}. ${platform} ${release} ${arch}.\u001b[22m\n`;
}

/** Says what is wrong with the arguments of `command`, then its help; the exit status is 1. */
function refused(ports: LauncherPorts, problem: string, help: string): number {
  ports.stderr(`${help}\n${problem}\n`);
  return 1;
}

/** `open`: the banner and the editor on the folder's address, or what is wrong and no editor. */
async function open(
  argv: readonly string[],
  ports: LauncherPorts,
): Promise<number> {
  const parsed = openArgumentsOf(argv);
  if (parsed.kind === 'help') {
    ports.stdout(OPEN_HELP_TEXT);
    return 0;
  }
  if (parsed.kind === 'unknown') {
    return refused(
      ports,
      `Unknown argument: ${parsed.argument}`,
      OPEN_HELP_TEXT,
    );
  }
  if (parsed.kind === 'missing') {
    return refused(
      ports,
      `Not enough arguments following: ${parsed.option}`,
      OPEN_HELP_TEXT,
    );
  }
  const plan = await openPlanOf(parsed, ports);
  if (plan.kind === 'refused') {
    ports.stderr(`${plan.message}\n`);
    return 1;
  }
  ports.stderr(bannerOf((await ports.cliOutput(['--version'])).trim(), ports));
  ports.launchEditor(openAddressOf(plan));
  return 0;
}

/** `build`: the CLI's `build` with the legacy arguments turned into its own, or the refusal of an argument it doesn't know. */
async function build(
  argv: readonly string[],
  ports: LauncherPorts,
): Promise<number> {
  const parsed = buildArgumentsOf(argv);
  if (parsed.kind === 'help') {
    ports.stdout(BUILD_HELP_TEXT);
    return 0;
  }
  if (parsed.kind === 'unknown') {
    return refused(
      ports,
      `Unknown argument: ${parsed.argument}`,
      BUILD_HELP_TEXT,
    );
  }
  if (parsed.kind === 'missing') {
    return refused(
      ports,
      `Not enough arguments following: ${parsed.option}`,
      BUILD_HELP_TEXT,
    );
  }
  return ports.runCli(['build', ...parsed.forwarded]);
}

/** Runs the launcher on `argv` and gives the exit status. */
export async function runLauncher(
  argv: readonly string[],
  ports: LauncherPorts,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'open') {
    return open(rest, ports);
  }
  if (command === 'build') {
    return build(rest, ports);
  }
  if (command === undefined || command === '--help' || command === '-h') {
    const [help, version] = await Promise.all([
      ports.cliOutput(['--help']),
      ports.cliOutput(['--version']),
    ]);
    ports.stdout(topHelpOf(help, version.trim(), ports.extensionPath));
    return 0;
  }
  return ports.runCli(argv);
}
