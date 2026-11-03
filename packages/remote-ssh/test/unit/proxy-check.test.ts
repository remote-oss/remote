import {deepStrictEqual} from 'node:assert';
import {invalidProxyHint} from '../../src/diagnostics/invalid-proxy.ts';
import {proxyProblem} from '../../src/pipeline/proxy-check.ts';
import {ownText} from '../../src/surfaces/own-strings.ts';

/** A stand-in for the editor's strict parser: no scheme, or a scheme with other characters, throws as it does. */
function strictParse(text: string): void {
  const colon = text.indexOf(':');
  if (colon === -1) {
    throw new Error(`[UriError]: Scheme is missing: {path: "${text}"}`);
  }
  if (!/^\w[\w\d+.-]*$/.test(text.slice(0, colon))) {
    throw new Error('[UriError]: Scheme contains illegal characters. (len:5)');
  }
}

/** The values with `changes`, both empty otherwise. */
function values(changes: {httpProxy?: string; httpsProxy?: string}): {
  httpProxy: string;
  httpsProxy: string;
} {
  return {httpProxy: '', httpsProxy: '', ...changes};
}

describe('the proxy settings checked as URIs (card connect-141)', () => {
  it('F-2404 7.E1: a leading space, literal quotes and a bare host are rejected with the parser message', () => {
    deepStrictEqual(
      [' http://p:1', '"http://p:1"', 'p'].map(
        value => proxyProblem(values({httpProxy: value}), strictParse)?.error,
      ),
      [
        '[UriError]: Scheme contains illegal characters. (len:5)',
        '[UriError]: Scheme contains illegal characters. (len:5)',
        '[UriError]: Scheme is missing: {path: "p"}',
      ],
    );
  });

  it('F-2404 6.3: a host and port without a scheme passes, and empty values are not parsed', () => {
    const parsed: string[] = [];
    const problem = proxyProblem(values({httpsProxy: 'p:3128'}), text => {
      parsed.push(text);
      strictParse(text);
    });
    deepStrictEqual([problem, parsed], [undefined, ['p:3128']]);
  });

  it('F-2404 7.E1: the HTTP value is reported before the HTTPS one', () => {
    deepStrictEqual(
      proxyProblem(values({httpProxy: 'one', httpsProxy: 'two'}), strictParse)
        ?.value,
      'one',
    );
  });

  it('F-2404 7.E1: a thrown value that is no error is reported as its text', () => {
    deepStrictEqual(
      proxyProblem(values({httpProxy: 'x'}), () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- the parser's contract allows any throw
        throw 'refused';
      }),
      {value: 'x', error: 'refused'},
    );
  });
});

describe('the hint of a rejected proxy value (card connect-141)', () => {
  it('F-2404 AC-27, 3.4: the InvalidProxyUrl row quotes the value and the message without its closing full stop', () => {
    const hint = invalidProxyHint(
      {value: ' http://p:1', error: '[UriError]: Scheme is missing.'},
      template => template,
    );
    deepStrictEqual(
      [hint.status, hint.message, hint.resources],
      [
        'InvalidProxyUrl',
        "Proxy URL in settings is invalid (Provided URL ' http://p:1' resulted in Error: [UriError]: Scheme is missing)",
        [],
      ],
    );
  });

  it('F-2404 AC-27: a message with no closing full stop is quoted whole', () => {
    const hint = invalidProxyHint(
      {value: 'p', error: 'Scheme contains illegal characters. (len:5)'},
      template => template,
    );
    deepStrictEqual(
      hint.message,
      "Proxy URL in settings is invalid (Provided URL 'p' resulted in Error: Scheme contains illegal characters. (len:5))",
    );
  });

  it('F-2404 AC-27: the three mitigations are in order, the scheme one naming http:// and https://', () => {
    deepStrictEqual(
      invalidProxyHint(
        {value: 'p', error: 'e'},
        template => template,
      ).mitigations.map(each => ownText(each, template => template)),
      [
        'Remove this value from settings or correct the URL',
        'URL must include the scheme (http:// or https://)',
        'URL should not contain non-URL characters',
      ],
    );
  });
});
