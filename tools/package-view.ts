/**
 * @fileoverview The view of a `pnpm package` run: a pure render of the run's three phases, in a styled mode for a
 * terminal and in no mode at all otherwise, where `package-run.ts` writes the plain lines. No I/O here.
 */

/** The style the run is rendered in. */
export type RunStyle = 'styled' | 'styled-mono';

/** The run `renderPackageRun` lays out: each phase's outcomes and its measured duration, in milliseconds. */
export interface PackageRun {
  /** The identifiers phase's outcomes, `<package>: <path>`. */
  identifiers: readonly string[];
  /** The build phase's outcomes, `<package>: <path>[, <path>…]` or a skipped package. */
  build: readonly string[];
  /** The package phase's outcomes, `<package>: <path>`, with each `.vsix`'s size in bytes. */
  packages: ReadonlyArray<{line: string; bytes: number}>;
  /** Each phase's duration in milliseconds, as measured. */
  milliseconds: {identifiers: number; build: number; package: number};
}

/** An outcome split at its first `: ` into its package name and the rest of the line. */
export interface Outcome {
  name: string;
  rest: string;
}

/** The inner width of both boxes, in display columns. */
const WIDTH = 56;

/** A build outcome whose rest is exactly this is a skipped package, not a bundle. */
const SKIPPED = 'no src/extension.ts, skipped';

/** The width-safe symbols: East Asian Width W, no variation selector, two columns in every terminal. */
const DOUBLE_WIDTH = new Set([
  '\u{1F4E1}', // 📡 the title
  '\u{1F9EC}', // 🧬 an identifier line
  '\u2728', // ✨ the identifiers summary
  '\u26A1', // ⚡ a bundle line
  '\u{1F310}', // 🌐 a web bundle's suffix
  '\u{1F4A4}', // 💤 the skipped block
  '\u{1F525}', // 🔥 the build summary
  '\u{1F4E6}', // 📦 a package line
  '\u{1F680}', // 🚀 the closing box
]);

/**
 * The SGR codes a `styled` render paints: an escape, a bracket, the codes and a letter, a `m`.
 */
// eslint-disable-next-line no-control-regex -- the escape is U+001B, the SGR introducer
const SGR_CODES = /\x1b\[[0-9;]*m/g;

/**
 * The display width of `text`: its ANSI SGR codes removed, the width-safe symbols counted as two columns and
 * every other code point as one, so a box padded with it keeps its right border in place.
 */
export function displayWidth(text: string): number {
  const stripped = text.replace(SGR_CODES, '');
  let width = 0;
  for (const symbol of stripped) {
    width += DOUBLE_WIDTH.has(symbol) ? 2 : 1;
  }
  return width;
}

/** Splits `line` at its first `: `; an outcome without one is the run's open row, so it names the line. */
export function parseOutcome(line: string): Outcome {
  const index = line.indexOf(': ');
  if (index === -1) {
    throw new Error(`an outcome without a ": ": ${line}`);
  }
  return {name: line.slice(0, index), rest: line.slice(index + 2)};
}

/**
 * A duration in the run's own units: under a second it is rounded milliseconds, a phase two-decimal seconds, and
 * the total, the sum of the three, one decimal.
 */
export function formatTiming(
  milliseconds: number,
  kind: 'phase' | 'total' = 'phase',
): string {
  if (milliseconds < 1000) {
    return `${String(Math.round(milliseconds))}ms`;
  }
  const seconds = (milliseconds / 1000).toFixed(kind === 'total' ? 1 : 2);
  return `${seconds}s`;
}

/**
 * The bar of a `.vsix`'s size against the largest: 12 cells, the share of the largest filled, at least one filled
 * cell for a non-empty file, the rest hollow.
 */
export function sizeBar(bytes: number, largest: number): string {
  let filled = 0;
  if (bytes > 0 && largest > 0) {
    filled = Math.max(1, Math.round(12 * (bytes / largest)));
  }
  return `${'\u2588'.repeat(filled)}${'\u2591'.repeat(12 - filled)}`;
}

/**
 * The mode of the run's output: `plain` for a non-terminal, a CI run, a dumb terminal or a `--plain` argument;
 * `styled-mono` on a terminal that sets `NO_COLOR`; `styled` otherwise.
 */
export function chooseMode(
  isTerminal: boolean,
  environment: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): 'plain' | RunStyle {
  if (
    !isTerminal ||
    environment.CI !== undefined ||
    environment.TERM === 'dumb' ||
    argv.includes('--plain')
  ) {
    return 'plain';
  }
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== '') {
    return 'styled-mono';
  }
  return 'styled';
}

/** A `styled` SGR wrap, or the bare text in `styled-mono`. */
function paint(codes: string, text: string, style: RunStyle): string {
  if (style !== 'styled') {
    return text;
  }
  return `\x1b[${codes}m${text}\x1b[0m`;
}

/** Pads `text` with spaces to `width` display columns. */
function padTo(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)));
}

/** Right-aligns `text` in `width` display columns. */
function alignRight(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - displayWidth(text))) + text;
}

/** One line of a box, the whole line painted: the left border, the content at the inner width, the right border. */
function boxLine(
  left: string,
  content: string,
  codes: string,
  style: RunStyle,
): string {
  return paint(codes, `${left}${padTo(content, WIDTH)}\u2502`, style);
}

/** The rule line of a box's top or bottom. */
function boxRule(
  left: string,
  right: string,
  codes: string,
  style: RunStyle,
): string {
  return paint(codes, `${left}${'\u2500'.repeat(WIDTH)}${right}`, style);
}

/** The run's title box. */
function titleBox(style: RunStyle): string[] {
  const codes = '1;35';
  return [
    `  ${boxRule('\u256d', '\u256e', codes, style)}`,
    `  ${boxLine('\u2502', '', codes, style)}`,
    `  ${boxLine('\u2502', '   \u{1F4E1}   R E M O T E   E X T E N S I O N S', codes, style)}`,
    `  ${boxLine('\u2502', '        build \u00B7 bundle \u00B7 ship', codes, style)}`,
    `  ${boxLine('\u2502', '', codes, style)}`,
    `  ${boxRule('\u2570', '\u256f', codes, style)}`,
  ];
}

/** A phase header: its rule, then the rule character to the inner width. */
function phaseHeader(text: string, style: RunStyle): string {
  const rule = `  ${text}`;
  return paint(
    '1;35',
    rule + '\u2501'.repeat(WIDTH - displayWidth(text)),
    style,
  );
}

/** A summary line: its count text, then the timing right-aligned so it ends at the inner width. */
function summaryLine(
  symbol: string,
  text: string,
  timing: string,
  style: RunStyle,
): string {
  const base = `  ${symbol} ${text}`;
  return (
    base +
    ' '.repeat(WIDTH - displayWidth(base) - displayWidth(timing)) +
    paint('2', timing, style)
  );
}

/** The run's closing box: the count and the total, green. */
function closingBox(
  extensions: number,
  total: number,
  style: RunStyle,
): string[] {
  const codes = '32';
  const headline = `  \u{1F680}  ${String(extensions)} ${
    extensions === 1 ? 'extension' : 'extensions'
  } ready for liftoff  \u00B7  ${formatTiming(total, 'total')} total`;
  return [
    `  ${boxRule('\u256d', '\u256e', codes, style)}`,
    `  ${boxLine('\u2502', headline, codes, style)}`,
    `  ${boxLine('\u2502', '      dist/*.vsix', codes, style)}`,
    `  ${boxRule('\u2570', '\u256f', codes, style)}`,
  ];
}

/** A `🧬` line: the package name in cyan, the path dim. */
function identifierLine(outcome: Outcome, style: RunStyle): string {
  return (
    `  \u{1F9EC}  ${paint('36', outcome.name.padEnd(19), style)}` +
    ` \u2192 ${paint('2', outcome.rest, style)}`
  );
}

/** The width of a build line's lead, up to and including the space before its `→`. */
const BUILD_LEAD = 26;

/** A build path: its `⚡` line for the first path of a package, its spaces for the rest. */
function buildPath(prefix: string, path: string, style: RunStyle): string {
  const webSuffix = path.startsWith('dist/web/')
    ? paint('2', '  \u{1F310}', style)
    : '';
  return `${prefix}${paint('2', `\u2192 ${path}`, style)}${webSuffix}`;
}

/** The skipped block: one `💤` line and the skipped names, four per line, the whole block gray. */
function skippedBlock(skipped: readonly string[], style: RunStyle): string[] {
  const lines = [
    paint(
      '90',
      `  \u{1F4A4}  ${String(skipped.length)} ${
        skipped.length === 1 ? 'package' : 'packages'
      } napping (no src/extension.ts)`,
      style,
    ),
  ];
  for (let index = 0; index < skipped.length; index += 4) {
    const chunk = skipped.slice(index, index + 4);
    lines.push(paint('90', `      ${chunk.join(' \u00B7 ')}`, style));
  }
  return lines;
}

/** The size of a `.vsix`: rounded kilobytes, or bare bytes under one. */
function sizeText(bytes: number): string {
  return bytes < 1024
    ? `${String(bytes)} B`
    : `${String(Math.round(bytes / 1024))} KB`;
}

/** A `📦` line: the file name, its bar against the largest, and its size in six columns. */
function packageLine(
  file: string,
  bytes: number,
  largest: number,
  style: RunStyle,
): string {
  return (
    `  \u{1F4E6}  ${paint('36', file.padEnd(30), style)}` +
    ` ${sizeBar(bytes, largest)} ${alignRight(sizeText(bytes), 6)}`
  );
}

/**
 * The run's output in `style`: the title box, each phase that has outcomes under its header, the skipped block,
 * the summaries with their timings, and the closing box when the run packaged at least one `.vsix`. A phase that
 * did not run holds no outcomes and renders nothing, which is how an error shows the phases that finished.
 */
export function renderPackageRun(
  packageRun: PackageRun,
  style: RunStyle,
): string {
  const lines: string[] = [''];
  lines.push(...titleBox(style));
  lines.push('');
  if (packageRun.identifiers.length > 0) {
    lines.push(phaseHeader('\u2501\u2501\u2501 \u2460 IDENTIFIERS ', style));
    lines.push('');
    for (const outcome of packageRun.identifiers) {
      lines.push(identifierLine(parseOutcome(outcome), style));
    }
    lines.push('');
    lines.push(
      summaryLine(
        '\u2728',
        `${String(packageRun.identifiers.length)} ${
          packageRun.identifiers.length === 1
            ? 'identifier file'
            : 'identifier files'
        } minted`,
        formatTiming(packageRun.milliseconds.identifiers),
        style,
      ),
    );
    lines.push('');
  }
  const skipped: string[] = [];
  const blocks: Array<{name: string; paths: string[]}> = [];
  let bundles = 0;
  for (const outcome of packageRun.build) {
    const parsed = parseOutcome(outcome);
    if (parsed.rest === SKIPPED) {
      skipped.push(parsed.name);
      continue;
    }
    const paths = parsed.rest.split(', ');
    bundles += paths.length;
    const last = blocks.at(-1);
    if (last?.name === parsed.name) {
      last.paths.push(...paths);
    } else {
      blocks.push({name: parsed.name, paths});
    }
  }
  if (packageRun.build.length > 0) {
    lines.push(phaseHeader('\u2501\u2501\u2501 \u2461 BUILD ', style));
    lines.push('');
    for (const block of blocks) {
      lines.push(
        buildPath(
          `  \u26A1  ${paint('36', block.name.padEnd(19), style)} `,
          block.paths[0] ?? '',
          style,
        ),
      );
      for (const path of block.paths.slice(1)) {
        lines.push(buildPath(' '.repeat(BUILD_LEAD), path, style));
      }
    }
    if (skipped.length > 0) {
      lines.push('');
      lines.push(...skippedBlock(skipped, style));
    }
    lines.push('');
    lines.push(
      summaryLine(
        '\u{1F525}',
        `${String(bundles)} ${bundles === 1 ? 'bundle' : 'bundles'} forged`,
        formatTiming(packageRun.milliseconds.build),
        style,
      ),
    );
    lines.push('');
  }
  if (packageRun.packages.length > 0) {
    lines.push(phaseHeader('\u2501\u2501\u2501 \u2462 PACKAGE ', style));
    lines.push('');
    const largest = Math.max(...packageRun.packages.map(item => item.bytes));
    for (const item of packageRun.packages) {
      const file = parseOutcome(item.line).rest.split('/').pop() ?? '';
      lines.push(packageLine(file, item.bytes, largest, style));
    }
    lines.push('');
    lines.push(
      ...closingBox(
        packageRun.packages.length,
        packageRun.milliseconds.identifiers +
          packageRun.milliseconds.build +
          packageRun.milliseconds.package,
        style,
      ),
    );
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
