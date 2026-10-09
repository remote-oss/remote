/**
 * @fileoverview The proxy value as re-serialised for the host: the http and https schemes are canonicalised,
 * every other scheme is returned as typed.
 */

import {strictEqual} from 'node:assert';
import {proxyVariableText} from '../../src/index.ts';

describe('proxyVariableText (card server-10 table)', () => {
  it('F-2404 BR-5: http://proxy.example:3128 -> http://proxy.example:3128/', () => {
    strictEqual(
      proxyVariableText('http://proxy.example:3128'),
      'http://proxy.example:3128/',
    );
  });

  it('F-2404 BR-5: https://proxy.example:3128 -> https://proxy.example:3128/', () => {
    strictEqual(
      proxyVariableText('https://proxy.example:3128'),
      'https://proxy.example:3128/',
    );
  });

  it('F-2404 BR-5: http://[::1]:3128 -> http://[::1]:3128/', () => {
    strictEqual(proxyVariableText('http://[::1]:3128'), 'http://[::1]:3128/');
  });

  it('F-2404 BR-5: http://$PROXYHOST:8890 -> http://%24proxyhost:8890/', () => {
    strictEqual(
      proxyVariableText('http://$PROXYHOST:8890'),
      'http://%24proxyhost:8890/',
    );
  });

  it('F-2404 BR-5: http://Proxy.Example:3128/path -> the host lower-cased, the path kept', () => {
    strictEqual(
      proxyVariableText('http://Proxy.Example:3128/path'),
      'http://proxy.example:3128/path',
    );
  });

  it('F-2404 BR-5: http://user:secret@proxy.example:3128 -> the userinfo kept', () => {
    strictEqual(
      proxyVariableText('http://user:secret@proxy.example:3128'),
      'http://user:secret@proxy.example:3128/',
    );
  });

  it('F-2404 BR-5: http:// -> http:/', () => {
    strictEqual(proxyVariableText('http://'), 'http:/');
  });

  it('F-2404 BR-5: http:proxy.example:3128 -> http:/proxy.example%3A3128', () => {
    strictEqual(
      proxyVariableText('http:proxy.example:3128'),
      'http:/proxy.example%3A3128',
    );
  });

  it('F-2404 BR-5: HTTP://proxy.example:3128 -> unchanged', () => {
    strictEqual(
      proxyVariableText('HTTP://proxy.example:3128'),
      'HTTP://proxy.example:3128',
    );
  });

  it('F-2404 BR-5: ftp://proxy.example:3128 -> unchanged', () => {
    strictEqual(
      proxyVariableText('ftp://proxy.example:3128'),
      'ftp://proxy.example:3128',
    );
  });

  it('F-2404 BR-5: proxy.example:3128 -> unchanged (the scheme is the host)', () => {
    strictEqual(proxyVariableText('proxy.example:3128'), 'proxy.example:3128');
  });

  it('F-2404 BR-5: the empty string -> unchanged', () => {
    strictEqual(proxyVariableText(''), '');
  });

  it('F-2404 BR-5: the userinfo keeps its case, only the host is lower-cased', () => {
    strictEqual(
      proxyVariableText('http://User:PassWord@proxy.example:3128'),
      'http://User:PassWord@proxy.example:3128/',
    );
  });

  it('F-2404 BR-5: the reserved characters of a path are percent-encoded', () => {
    strictEqual(
      proxyVariableText("http://proxy.example/a!b'c(d)e*f"),
      'http://proxy.example/a%21b%27c%28d%29e%2Af',
    );
  });

  it('F-2404 BR-5: a character outside the BMP is one UTF-8 percent sequence', () => {
    strictEqual(
      proxyVariableText('http://proxy.example/\u{1F600}'),
      'http://proxy.example/%F0%9F%98%80',
    );
  });

  it('F-2404 BR-5: a percent run that does not decode is kept, then its percent encoded', () => {
    strictEqual(
      proxyVariableText('http://proxy.example/%zz'),
      'http://proxy.example/%25zz',
    );
  });

  it('F-2404 BR-5: a two-letter hex run that is not a single byte is kept as literal', () => {
    strictEqual(
      proxyVariableText('http://proxy.example/%FF'),
      'http://proxy.example/%25FF',
    );
  });

  it('F-2404 BR-5: several undecodable percent pieces are each kept, then each percent encoded', () => {
    strictEqual(
      proxyVariableText('http://proxy.example/%zz%zz'),
      'http://proxy.example/%25zz%25zz',
    );
  });

  it('F-2404 BR-5: a drive letter at the start of the path is lower-cased and its colon encoded', () => {
    strictEqual(
      proxyVariableText('http://proxy.example/C:/dir'),
      'http://proxy.example/c%3A/dir',
    );
  });
});

describe('proxyVariableText (the parser branches)', () => {
  it('server-10 (branch: query): a query is kept and its = encoded', () => {
    strictEqual(
      proxyVariableText('http://proxy.example:3128/p?name=ferret'),
      'http://proxy.example:3128/p?name%3Dferret',
    );
  });

  it('server-10 (branch: fragment): a fragment is kept', () => {
    strictEqual(
      proxyVariableText('http://proxy.example:3128/p#nose'),
      'http://proxy.example:3128/p#nose',
    );
  });

  it('server-10 (branch: missing port): an authority without a port is kept', () => {
    strictEqual(
      proxyVariableText('http://proxy.example'),
      'http://proxy.example/',
    );
  });

  it('server-10 (branch: userinfo without a password): the name is kept', () => {
    strictEqual(
      proxyVariableText('http://user@proxy.example:3128'),
      'http://user@proxy.example:3128/',
    );
  });

  it('server-10 (branch: percent-decode): a percent-escaped slash is decoded then re-emitted plain', () => {
    strictEqual(
      proxyVariableText('http://proxy.example:3128/a%2Fb'),
      'http://proxy.example:3128/a/b',
    );
  });
  it('server-10 (branch: a path whose second character is not an upper-case drive letter keeps it', () => {
    strictEqual(
      proxyVariableText('http://proxy.example/a:x'),
      'http://proxy.example/a%3Ax',
    );
  });

  it('server-10 (branch: a native-encoded run flushed by a table-escaped character', () => {
    strictEqual(
      proxyVariableText('http://proxy.example/\u{1F600}:x'),
      'http://proxy.example/%F0%9F%98%80%3Ax',
    );
  });
});
