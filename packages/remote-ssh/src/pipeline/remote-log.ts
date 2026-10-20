/**
 * @fileoverview The remote side's script output in the log: each line a run prints is logged as remote output before
 * its reader gets it. The result block stays out of the log, line by line, and is logged once as the summary of its
 * parse. The connection token is masked, an address keeps no user, password, query or fragment, and a value the run
 * was given in its environment is logged by its name. No code reads what is logged.
 */

import {type HostChannel, hostPathOf} from 'lib-host';
import type {Logger} from 'lib-log';
import {parseResult, RESULT_BEGIN, RESULT_END} from 'lib-server';
import {masked, serverResultLine} from '../diagnostics/log-content.ts';

/** The shortest value of a run's environment that the log names instead of showing; a shorter one is too common to hide. */
const SECRET_LENGTH = 8;

/** An address in a line: a scheme, `://`, then everything up to white space or a quote. */
const ADDRESS = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi;

/**
 * `address` with its user and password, query and fragment left out, which may hold a token; its scheme, host and
 * path are kept. Text that doesn't parse as an address keeps only what comes before its first `?` or `#`, with no `@`
 * part.
 */
function addressShown(address: string): string {
  if (URL.canParse(address)) {
    const parsed = new URL(address);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  }
  const [beforeQuery = ''] = address.split(/[?#]/, 1);
  return beforeQuery.replace(/:\/\/[^/]*@/, '://');
}

/** `line` with the token masked, each address's secrets left out, and each long environment value named. */
function scrubbed(
  line: string,
  token: string | undefined,
  environment: Readonly<Record<string, string>>,
): string {
  let text = masked(line, token).replace(ADDRESS, addressShown);
  // The longest value goes first, so a shorter value inside it can't leave the rest of it in clear.
  const secrets = Object.entries(environment)
    .filter(([, value]) => value.length >= SECRET_LENGTH)
    .sort(([, first], [, second]) => second.length - first.length);
  for (const [variable, value] of secrets) {
    text = text.replaceAll(value, () => `\${${variable}}`);
  }
  return text;
}

/** `channel`, whose runs also log their output through `logger`; every other operation is the channel's own. */
export function loggedChannel(
  channel: HostChannel,
  logger: Pick<Logger, 'info'>,
): HostChannel {
  let token: string | undefined;
  return {
    runScript: (request, onLine) => {
      let block: string[] | undefined;
      return channel.runScript(request, line => {
        const bare = line.replace(/\r$/, '');
        if (block !== undefined) {
          if (bare === RESULT_END) {
            const parsed = parseResult([RESULT_BEGIN, ...block, RESULT_END]);
            block = undefined;
            if ('block' in parsed) {
              token = parsed.block.serverFacts.token ?? token;
              logger.info(serverResultLine(parsed.block));
            }
          } else {
            block.push(line);
          }
        } else if (bare === RESULT_BEGIN) {
          block = [];
        } else if (bare !== '') {
          logger.info(`[remote] ${scrubbed(bare, token, request.environment)}`);
        }
        onLine(line);
      });
    },
    copyToHost: request => channel.copyToHost(request),
    identity: () => channel.identity(),
    platformHint: () => channel.platformHint(),
    clientPathOnHost: localFile => hostPathOf(channel, localFile),
  };
}
