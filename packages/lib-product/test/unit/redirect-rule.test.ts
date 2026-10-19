import {deepStrictEqual, strictEqual} from 'node:assert';
import {redirectAllows, redirectRuleFor} from '../../src/index.ts';

const LISTED = {
  serverDownloadRedirectHosts: ['CDN.example.com', 'cdn.example.com'],
};

describe('redirectAllows (card server-22)', () => {
  it('the rule any allows every host', () => {
    strictEqual(
      redirectAllows({kind: 'any'}, 'anything.example.invalid'),
      true,
    );
  });

  it('a list matches exactly and ignoring case', () => {
    const rule = {kind: 'hosts', hosts: ['cdn.example.com']} as const;
    strictEqual(redirectAllows(rule, 'CDN.Example.com'), true);
  });

  it('a list matches neither a sub-domain nor a parent', () => {
    const rule = {kind: 'hosts', hosts: ['cdn.example.com']} as const;
    deepStrictEqual(
      [
        redirectAllows(rule, 'a.cdn.example.com'),
        redirectAllows(rule, 'example.com'),
      ],
      [false, false],
    );
  });
});

describe('redirectRuleFor (card server-22)', () => {
  it('an override gives any host', () => {
    deepStrictEqual(redirectRuleFor(LISTED, 'override', 'dl.example.com'), {
      kind: 'any',
    });
  });

  it("a product template gives the host first, the table's hosts, then the listed ones, lower case, without repeats", () => {
    deepStrictEqual(redirectRuleFor(LISTED, 'productTemplate', 'GitHub.com'), {
      kind: 'hosts',
      hosts: [
        'github.com',
        'objects.githubusercontent.com',
        'release-assets.githubusercontent.com',
        'cdn.example.com',
      ],
    });
  });

  it("a built-in table source gives the host and the table's, and ignores the list", () => {
    deepStrictEqual(redirectRuleFor(LISTED, 'builtInTable', 'dl.example.com'), {
      kind: 'hosts',
      hosts: ['dl.example.com'],
    });
  });

  it('an entry that is not a host name is kept and matches nothing', () => {
    const rule = redirectRuleFor(
      {serverDownloadRedirectHosts: ['not a host']},
      'productTemplate',
      'dl.example.com',
    );
    deepStrictEqual(
      [
        redirectAllows(rule, 'dl.example.com'),
        redirectAllows(rule, 'x.invalid'),
      ],
      [true, false],
    );
  });
});
