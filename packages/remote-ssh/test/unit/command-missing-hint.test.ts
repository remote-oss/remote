import {deepStrictEqual} from 'node:assert';
import {commandMissingHint} from '../../src/diagnostics/command-missing-hint.ts';
import {ownText} from '../../src/surfaces/own-strings.ts';

describe('the hint of an install that stopped for a program the host lacks (card #2856)', () => {
  const hint = commandMissingHint('tar');

  it('F-2402 7.E3: the message is the text for a command the host does not have, and the status is the extension’s own', () => {
    deepStrictEqual(
      [
        hint.status,
        typeof hint.message === 'string'
          ? hint.message
          : ownText(hint.message, template => template),
        hint.details,
      ],
      [
        'CommandMissing',
        'A command required on the remote machine was not found',
        undefined,
      ],
    );
  });

  it('F-2402 7.E3: the mitigations are, in this order, to install the program that is missing and to put it on the PATH', () => {
    deepStrictEqual(
      [commandMissingHint('tar'), commandMissingHint('gzip')].map(each =>
        each.mitigations.map(mitigation =>
          ownText(mitigation, template => template),
        ),
      ),
      [
        [
          "Install 'tar' on the remote server. Installation steps will vary per distribution.",
          "Ensure this program is installed on the remote machine and accessible via the 'PATH' environment variable",
        ],
        [
          "Install 'gzip' on the remote server. Installation steps will vary per distribution.",
          "Ensure this program is installed on the remote machine and accessible via the 'PATH' environment variable",
        ],
      ],
    );
  });

  it('F-2402 7.E3: the hint has no resources', () => {
    deepStrictEqual(hint.resources, []);
  });
});
